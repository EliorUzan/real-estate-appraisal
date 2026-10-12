"""Provision a private, exact-host HTTPS relay for the personal Codespaces test.

Does not enable providers or read native credentials. Unsupported engine options
fail closed; never substitute an ordinary bridge for the isolated job network.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
from cli_gateway.runner import Docker
from cli_gateway.network import controls
from cli_gateway.recovery import Journal


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--build", required=True)
    parser.add_argument("--replace-drained", action="store_true", help="Replace this reviewed credential-free relay after confirmed stop")
    args = parser.parse_args()
    if os.environ.get("CODESPACES") != "true":
        raise ValueError("Personal Codespaces only")
    config = Path(args.config)
    if not config.is_file() or config.is_symlink() or config.stat().st_mode & 0o077:
        raise ValueError("Private regular configuration required")
    values = dict(line.split("=", 1) for line in config.read_text().splitlines() if line and not line.startswith("#"))
    if values.get("DOCKER_HOST"):
        os.environ["DOCKER_HOST"] = values["DOCKER_HOST"]
    data = Path(values["CLI_DATA_DIR"])
    build = json.loads(Path(args.build).read_text())
    if build.get("cliRuntime") != "antigravity" or not re.fullmatch(r"sha256:[0-9a-f]{64}", build["image"]):
        raise ValueError("Reviewed immutable image required")
    with (data / "supervisor.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        engine = Docker()
        if engine.inventory():
            raise ValueError("Stop native jobs and login containers first")
        if Journal(data / 'journal').load():
            raise ValueError('Reconcile the outstanding attempt first')
        report_path = data / 'egress-gemini.json'
        if args.replace_drained:
            if report_path.is_symlink() or not report_path.is_file() or report_path.stat().st_mode & 0o077:
                raise ValueError('Existing private regular relay report required')
            previous = report_path.read_bytes()
            controls(engine, {'network':'cli-provider-gemini', 'egressFile':str(report_path.resolve()),
                              'egressDigest':hashlib.sha256(previous).hexdigest()})
            # controls verifies the sole owned relay, mounts, command and network.
            engine.stop('cli-egress-gemini')
            engine.remove('cli-egress-gemini')
        elif report_path.exists():
            raise ValueError('A relay report already exists; reviewed drained replacement required')
        directory = data / "egress-gemini"
        directory.mkdir(mode=0o700, exist_ok=True)
        inputs = {
            "egress.py": Path(__file__).resolve().parents[2] / "src/cli_gateway/egress.py",
            "policy.json": Path(__file__).resolve().with_name("antigravity-egress.json"),
        }
        digests = {}
        for name, source in inputs.items():
            target = directory / name
            raw = source.read_bytes()
            if target.is_symlink():
                raise ValueError("Relay source may not be a symlink")
            if target.exists():
                if not target.is_file():
                    raise ValueError('Relay source must be regular')
                if target.read_bytes() != raw and not args.replace_drained:
                    raise ValueError("Existing relay source changed; drained review required")
                if target.read_bytes() != raw:
                    temporary = directory / (name + '.new')
                    with temporary.open('xb') as output:
                        output.write(raw)
                    temporary.chmod(0o444)
                    temporary.replace(target)
            else:
                target.write_bytes(raw)
                target.chmod(0o444)
            digests[name] = hashlib.sha256(raw).hexdigest()
        network, relay = "cli-provider-gemini", "cli-egress-gemini"
        networks = engine.command(["network", "ls", "--format", "{{.Name}}"]).decode().splitlines()
        if network not in networks:
            engine.command(["network", "create", "--driver", "bridge", "--internal",
                            "--label", "appraisal.cli-egress=1",
                            "--opt", "com.docker.network.bridge.gateway_mode_ipv4=isolated", network])
        info = json.loads(engine.command(["network", "inspect", network]))[0]
        if info.get("Containers") or info.get("Labels", {}).get("appraisal.cli-egress") != "1" or info.get("Internal") is not True or info.get("EnableIPv6") is not False or info.get("Options", {}).get("com.docker.network.bridge.gateway_mode_ipv4") != "isolated":
            raise ValueError("Isolated IPv4-only network required")
        subnet = ipaddress.ip_network(info["IPAM"]["Config"][0]["Subnet"])
        bind = str(subnet.network_address + 2)
        engine.command(["create", "--name", relay, "--label", "appraisal.cli-egress=1",
                        "--restart", "no", "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
                        "--security-opt", "no-new-privileges", "--cpus", "0.5", "--memory", "128m", "--pids-limit", "32",
                        "--log-driver", "local", "--log-opt", "max-size=1m", "--log-opt", "max-file=1", "--log-opt", "compress=false",
                        "--network", "bridge", "--entrypoint", "python3",
                        "--mount", "type=bind,source=" + str(directory / "egress.py") + ",target=/opt/egress.py,readonly",
                        "--mount", "type=bind,source=" + str(directory / "policy.json") + ",target=/opt/policy.json,readonly",
                        build["image"], "/opt/egress.py", "--policy", "/opt/policy.json", "--bind", bind])
        engine.command(["network", "connect", "--ip", bind, network, relay])
        engine.command(["start", relay])
        state = engine.inspect(relay)
        if not state.get("Running"):
            raise ValueError("Relay failed to start")
        report = {"network": network, "networkId": info["Id"], "proxyContainer": relay,
                  "proxyUrl": "http://" + bind + ":8888", "proxyImage": build["image"],
                  "codeDigest": digests["egress.py"], "policyDigest": digests["policy.json"],
                  "codeFile": str(directory / "egress.py"), "policyFile": str(directory / "policy.json"),
                  "g2Passed": False}
        target = data / "egress-gemini.json.new"
        with target.open("x") as output:
            target.chmod(0o600)
            json.dump(report, output, indent=2)
        target.replace(report_path)
        print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Relay setup failed closed. Provider stays disabled; review owned resources before retrying.", flush=True)
        raise SystemExit(1) from None
