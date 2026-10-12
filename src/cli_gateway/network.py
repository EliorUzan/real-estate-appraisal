"""Check the live relay and engine network before every native job is created."""
import hashlib
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


def regular_bytes(value, digest):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path or not path.is_file() or path.is_symlink():
        raise ValueError("Absolute regular operator file required")
    raw = path.read_bytes()
    if not isinstance(digest, str) or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError("Operator file changed after review")
    return raw


def controls(engine, manifest, *, allow_stopped_relay=False):
    network = manifest["network"]
    if network == "none":
        return []  # Safe offline fixtures; the model cannot be invoked here.
    if network == "bridge" and manifest.get("syntheticDiagnostic") is True and manifest.get("executionHostMode") == "codespaces-personal" and not manifest.get("g1Passed") and not manifest.get("g2Passed"):
        return []  # Operator-only fixed synthetic persisted-auth probe.
    if not re.fullmatch(r"cli-(?:provider|login)-(gemini|claude|openai)", network):
        raise ValueError("Private provider relay network required")
    raw = regular_bytes(manifest["egressFile"], manifest["egressDigest"])
    policy = json.loads(raw)
    if policy.get("network") != network:
        raise ValueError("Relay network mismatch")
    regular_bytes(policy["codeFile"], policy["codeDigest"])
    regular_bytes(policy["policyFile"], policy["policyDigest"])
    url = urlsplit(policy["proxyUrl"])
    if url.scheme != "http" or url.port != 8888 or url.path or url.query or url.fragment or url.username or url.password:
        raise ValueError("Invalid internal relay address")
    proxy_ip = ipaddress.ip_address(url.hostname)
    info = json.loads(engine.command(["network", "inspect", network]))[0]
    if info.get("Id") != policy["networkId"] or info.get("Driver") != "bridge" or info.get("Internal") is not True or info.get("EnableIPv6") is not False or info.get("Labels", {}).get("appraisal.cli-egress") != "1" or info.get("Options", {}).get("com.docker.network.bridge.gateway_mode_ipv4") != "isolated":
        raise ValueError("Provider network isolation changed")
    subnet = ipaddress.ip_network(info["IPAM"]["Config"][0]["Subnet"])
    if proxy_ip not in subnet:
        raise ValueError("Relay address is outside the provider network")
    relay = json.loads(engine.command(["inspect", policy["proxyContainer"]]))[0]
    state = relay['State']
    restarting = state.get('Restarting')
    stopped = (allow_stopped_relay and not state.get('Running') and not restarting
               and state.get('Status') in {'created', 'exited'})
    peers = info.get("Containers", {})
    if set(peers) != {relay["Id"]} and not (stopped and not peers):
        raise ValueError("Unexpected peer in private provider network")
    host = relay["HostConfig"]
    links = relay["NetworkSettings"]["Networks"]
    address_matches = (links.get(network, {}).get('IPAddress') == str(proxy_ip)
                       or stopped and (links.get(network, {}).get('IPAMConfig') or {}).get('IPv4Address') == str(proxy_ip))
    if (not state.get('Running') and not stopped or restarting or relay["Image"] != policy["proxyImage"]
        or relay["Config"].get("Labels", {}).get("appraisal.cli-egress") != "1" or set(links) != {"bridge", network}
        or not address_matches):
        raise ValueError("Relay runtime changed")
    if host.get("Privileged") or host.get("ReadonlyRootfs") is not True or host.get("CapAdd") or "ALL" not in host.get("CapDrop", []) or "no-new-privileges" not in host.get("SecurityOpt", []):
        raise ValueError("Relay engine controls changed")
    if relay["Config"].get("User") != "1000:1000" or relay["Config"].get("Entrypoint") != ["python3"] or relay["Config"].get("Cmd") != ["/opt/egress.py", "--policy", "/opt/policy.json", "--bind", str(proxy_ip)]:
        raise ValueError("Relay command changed")
    expected = {(policy["codeFile"], "/opt/egress.py"), (policy["policyFile"], "/opt/policy.json")}
    mounts = relay.get("Mounts", [])
    if len(mounts) != 2 or any(m.get("Type") != "bind" or m.get("RW") is not False for m in mounts) or {(m["Source"], m["Destination"]) for m in mounts} != expected:
        raise ValueError("Relay mounts changed")
    return ["--dns", "127.0.0.1", "--env", "HTTPS_PROXY=" + policy["proxyUrl"],
            "--env", "HTTP_PROXY=" + policy["proxyUrl"], "--env", "NO_PROXY=localhost,127.0.0.1,::1"]
