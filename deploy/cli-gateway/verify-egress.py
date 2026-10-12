"""Credential-free network checks on the isolated personal job network."""
import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path
import uuid
from cli_gateway.network import controls
from cli_gateway.runner import Docker


PROBE = '''import json,socket,ssl,urllib.request,urllib.error,sys
proxy,host,port=sys.argv[1],sys.argv[2],int(sys.argv[3])
tests={}
def connectable(host,port):
    try:
        s=socket.create_connection((host,port),timeout=1);s.close();return True
    except OSError:return False
tests['direct_public_blocked']=not connectable('1.1.1.1',443)
tests['metadata_blocked']=not connectable('169.254.169.254',80)
tests['private_canary_blocked']=not connectable(host,port)
tests['ipv6_external_blocked']=not connectable('2606:4700:4700::1111',443)
import subprocess
try:
    dns=subprocess.run([sys.executable,'-c',"import socket; socket.getaddrinfo('example.com',443)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)
    tests['external_dns_blocked']=dns.returncode!=0
except subprocess.TimeoutExpired:tests['external_dns_blocked']=True
from urllib.parse import urlsplit
p=urlsplit(proxy)
for label,target in [('unlisted_host','example.com:443'),('private_ip','127.0.0.1:443'),('metadata_proxy','169.254.169.254:443'),('ipv6_literal','[::1]:443'),('wrong_port','oauth2.googleapis.com:80'),('userinfo','x@oauth2.googleapis.com:443'),('google_metrics','play.googleapis.com:443')]:
    with socket.create_connection((p.hostname,p.port),timeout=3) as s:
        s.sendall(('CONNECT '+target+' HTTP/1.1\\r\\nHost: '+target+'\\r\\n\\r\\n').encode())
        tests[label+'_denied']=s.recv(256).startswith(b'HTTP/1.1 403 ')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':proxy}),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
for name,url in [('approved_google_tls','https://oauth2.googleapis.com/'),('approved_google_identity_tls','https://www.googleapis.com/oauth2/v3/tokeninfo'),('approved_google_profile_tls','https://lh3.googleusercontent.com/')]:
    try:
        with opener.open(urllib.request.Request(url,method='HEAD'),timeout=15) as r:tests[name]=r.status<500
    except urllib.error.HTTPError as e:tests[name]=e.code<500
    except Exception:tests[name]=False
print(json.dumps(tests))
'''

probe_phase = "configuration"


def main():
    global probe_phase
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--egress", required=True)
    args = parser.parse_args()
    if os.environ.get("CODESPACES") != "true":
        raise ValueError("Personal Codespaces only")
    config = Path(args.config)
    if config.is_symlink() or not config.is_file() or config.stat().st_mode & 0o077:
        raise ValueError("Private regular configuration required")
    values = dict(line.split("=", 1) for line in config.read_text().splitlines() if line and not line.startswith("#"))
    if values.get("DOCKER_HOST"):
        os.environ["DOCKER_HOST"] = values["DOCKER_HOST"]
    data = Path(values["CLI_DATA_DIR"])
    path = Path(args.egress).resolve()
    raw = path.read_bytes()
    egress = json.loads(raw)
    engine = Docker()
    with (data / "supervisor.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if engine.inventory():
            raise ValueError("Stop native jobs and login containers before checking the network")
        probe_phase = "live relay controls"
        flags = controls(engine, {"network": egress["network"], "egressFile": str(path), "egressDigest": hashlib.sha256(raw).hexdigest()})
        port = 8080
        fixed = ["--read-only", "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                 "--cpus", "0.5", "--memory", "128m", "--pids-limit", "32", "--log-driver", "none", "--entrypoint", "python3"]
        name = "cli-egress-probe-" + str(uuid.uuid4())
        canary = "cli-egress-canary-" + str(uuid.uuid4())
        try:
            probe_phase = "private fixture startup"
            # Codespaces may place the operator and Docker daemon in different
            # namespaces. Put the disposable positive-control fixture on the
            # engine's bridge instead of assuming the operator's host address.
            engine.command(["create", "--name", canary, "--label", "appraisal.cli-egress-probe=1",
                            "--network", "bridge", *fixed, egress["proxyImage"], "-c",
                            "import socket,time; s=socket.socket(); s.bind(('0.0.0.0',8080)); s.listen(8); s.settimeout(50);\nwhile True:\n c,a=s.accept(); c.close()"])
            engine.command(["start", canary])
            canary_info = json.loads(engine.command(["inspect", canary]))[0]
            host = canary_info["NetworkSettings"]["Networks"]["bridge"]["IPAddress"]
            # Positive control proves the private fixture is reachable from bridge.
            probe_phase = "private fixture positive control"
            baseline = engine.command(["run", "--rm", "--network", "bridge", *fixed, egress["proxyImage"], "-c",
                                       "import socket,sys; s=socket.create_connection((sys.argv[1],int(sys.argv[2])),timeout=3); s.close(); print('PRIVATE_CANARY_REACHABLE')", host, str(port)], timeout=10)
            if baseline.strip() != b"PRIVATE_CANARY_REACHABLE":
                raise ValueError("Private canary positive control failed")
            probe_phase = "isolated network checks"
            engine.command(["create", "--name", name, "--label", "appraisal.cli-egress-probe=1",
                            "--network", egress["network"], *flags, *fixed, egress["proxyImage"], "-c", PROBE,
                            egress["proxyUrl"], host, str(port)])
            process = subprocess.run([engine.executable, "start", "--attach", name],
                                     capture_output=True, env=engine.env, timeout=45, check=False)
            probe_phase = "network verdict validation"
            if process.returncode:
                stderr = process.stderr.decode("utf-8", errors="replace")
                failure = {"checksExitCode": process.returncode,
                           "failureTypes": [kind for kind in ("SyntaxError", "TimeoutError", "ConnectionRefusedError", "OSError", "MemoryError") if kind in stderr],
                           "networkChecksPassed": False, "g2Passed": False}
                print(json.dumps(failure, indent=2), flush=True)
                return
            tests = json.loads(process.stdout)
            if not isinstance(tests, dict) or len(tests) != 15 or any(type(value) is not bool for value in tests.values()):
                raise ValueError("Unexpected network test result")
            report = {"tests": tests, "privateCanaryPositiveControl": True,
                      "networkChecksPassed": all(tests.values()), "g2Passed": False,
                      "egressDigest": hashlib.sha256(raw).hexdigest()}
            target = data / (name + ".json")
            with target.open("x") as stream:
                target.chmod(0o600)
                json.dump(report, stream, indent=2)
            print(json.dumps(report, indent=2), flush=True)
        finally:
            # If start timed out, stop the actual container, then remove it.
            for target in (name, canary):
                try:
                    engine.stop(target)
                    engine.remove(target)
                except Exception:
                    if target in engine.command(["ps", "-a", "--format", "{{.Names}}"]).decode().splitlines():
                        raise ValueError("Network probe stop needs operator recovery") from None


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Network verification failed closed at " + probe_phase + " (" + type(exc).__name__ + "); provider remains disabled.", flush=True)
        raise SystemExit(1) from None
