"""Bounded HTTPS CONNECT relay. Native TLS stays encrypted end to end.

Only exact operator-approved DNS names on port 443 are accepted. All resolved
addresses must be public unicast; sockets connect to those checked numeric IPs.
No headers, request bodies, paths, credentials, or rejected hostnames are logged.
"""
import argparse
import ipaddress
import json
from pathlib import Path
import re
import select
import socket
import socketserver
import threading
import time


def authority(value, allowed):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,252}:443", value):
        raise ValueError("DENIED_AUTHORITY")
    host = value[:-4]
    if host not in allowed or any(not part or part.startswith('-') or part.endswith('-') for part in host.split('.')):
        raise ValueError("DENIED_AUTHORITY")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return host
    raise ValueError("DENIED_AUTHORITY")


def public_addresses(host):
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses:
        raise ValueError("DENIED_RESOLUTION")
    for _family, _kind, _protocol, _canon, address in addresses:
        ip = ipaddress.ip_address(address[0])
        if not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified or getattr(ip, "ipv4_mapped", None):
            raise ValueError("DENIED_RESOLUTION")
    return addresses


class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        upstream = None
        target = None
        try:
            self.request.settimeout(10)
            header = bytearray()
            while not header.endswith(b"\r\n\r\n"):
                byte = self.request.recv(1)
                if not byte or len(header) >= 8192:
                    raise ValueError("DENIED_HEADER")
                header.extend(byte)
            lines = header.decode("ascii", errors="strict").split("\r\n")
            method, target, version = lines[0].split(" ")
            if method != "CONNECT" or version not in ("HTTP/1.0", "HTTP/1.1"):
                raise ValueError("DENIED_METHOD")
            host = authority(target, self.server.allowed)
            # The gateway does not need client credentials, bodies, or upgrades.
            for line in lines[1:-2]:
                key, _value = line.split(":", 1)
                if key.lower() not in ("host", "user-agent", "proxy-connection"):
                    raise ValueError("DENIED_HEADER")
            for family, kind, protocol, _canon, address in public_addresses(host):
                candidate = socket.socket(family, kind, protocol)
                candidate.settimeout(10)
                try:
                    candidate.connect(address)
                    upstream = candidate
                    break
                except OSError:
                    candidate.close()
            if upstream is None:
                raise ValueError("UPSTREAM_UNAVAILABLE")
            self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            print(json.dumps({"event": "allowed", "host": host}), flush=True)
            deadline, idle = time.monotonic() + 300, time.monotonic() + 45
            sockets = (self.request, upstream)
            while time.monotonic() < min(deadline, idle):
                readable, _w, _e = select.select(sockets, [], [], 1)
                for source in readable:
                    chunk = source.recv(16384)
                    if not chunk:
                        return
                    (upstream if source is self.request else self.request).sendall(chunk)
                    idle = time.monotonic() + 45
        except Exception as exc:
            # An exception can include an arbitrary authority or a transport URL.
            reason = str(exc) if isinstance(exc, ValueError) and str(exc) in {
                "DENIED_HEADER", "DENIED_METHOD", "DENIED_AUTHORITY", "DENIED_RESOLUTION", "UPSTREAM_UNAVAILABLE"
            } else "TRANSPORT_ERROR"
            event = {"event": "denied", "reason": reason}
            # Fixed, reviewed destinations only. Unknown authorities (which can
            # contain attacker-controlled text) are never written to logs.
            candidate = {'lh3.googleusercontent.com:443':'GOOGLE_PROFILE_PHOTO',
                         'accounts.google.com:443':'GOOGLE_ACCOUNT',
                         'www.googleapis.com:443':'GOOGLE_API_WWW',
                         'play.googleapis.com:443':'GOOGLE_METRICS'}.get(target)
            if reason == 'DENIED_AUTHORITY' and candidate:
                event['candidate'] = candidate
            print(json.dumps(event), flush=True)
            if upstream is None:
                try:
                    self.request.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                except OSError:
                    pass
        finally:
            if upstream:
                upstream.close()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, allowed):
        self.allowed = frozenset(allowed)
        self.slots = threading.BoundedSemaphore(32)
        super().__init__(address, Relay)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--bind", required=True, help="Internal-only network address")
    args = parser.parse_args()
    policy = json.loads(Path(args.policy).read_text())
    if set(policy) != {"allowedHosts"} or not isinstance(policy["allowedHosts"], list) or not policy["allowedHosts"]:
        raise ValueError("Exact host allowlist required")
    for host in policy["allowedHosts"]:
        authority(host + ":443", policy["allowedHosts"])
    with Server((args.bind, 8888), policy["allowedHosts"]) as server:
        print('{"event":"ready"}', flush=True)
        server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
