"""Operator-assisted native login; no passwords or tokens are accepted as arguments."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
from cli_gateway.client import Client
from cli_gateway.runner import Docker
from cli_gateway.recovery import Journal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Private reviewed worker.env file")
    parser.add_argument("--connection", required=True)
    parser.add_argument("--revision", type=int, required=True)
    parser.add_argument("--build", required=True, help="Private build evidence produced by build-images.py")
    args = parser.parse_args()
    config = Path(args.config)
    if config.is_symlink() or config.stat().st_mode & 0o077:
        raise ValueError("Worker configuration must be a private regular file")
    values = dict(line.split("=", 1) for line in config.read_text().splitlines() if line and not line.startswith("#"))
    data = Path(values["CLI_DATA_DIR"])
    data.mkdir(mode=0o700, parents=True, exist_ok=True)
    secret = Path(values["CLI_HOST_SECRET_FILE"])
    if secret.is_symlink() or secret.stat().st_mode & 0o077:
        raise ValueError("Host credential must be a private regular file")
    client = Client(values["CLI_WORKER_URL"], values["CLI_HOST_ID"], secret.read_text().strip())
    if values.get("DOCKER_HOST"):
        os.environ["DOCKER_HOST"] = values["DOCKER_HOST"]
    engine = Docker()
    build = json.loads(Path(args.build).read_text())
    provider = build["provider"]
    commands = {"gemini": ["agy", "--log-file", "/dev/null"], "openai": ["codex", "login", "--device-auth"], "claude": ["claude", "auth", "login"]}
    if provider not in commands or not re.fullmatch(r"sha256:[0-9a-f]{64}", build["image"]):
        raise ValueError("Unsupported native image")
    if provider == "gemini" and (build.get("cliRuntime") != "antigravity" or build.get("command") != "agy"):
        raise ValueError("Legacy Gemini login is unsupported for this personal setup")
    with (data / "supervisor.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if engine.inventory() or not client.call("heartbeatHost", manifests=[]).get("drain"):
            raise ValueError("Drain and stop the supervisor before native login")
        if Journal(data / 'journal').load() or client.call('getAssignment').get('job'):
            raise ValueError('Reconcile the existing assignment before native login')
        connection = next((c for c in client.call("getMaintenance")["connections"]
                           if c["id"] == args.connection and c["revision"] == args.revision
                           and c["provider"] == provider and c["status"] == "pending_setup"), None)
        if not connection or not re.fullmatch(r"cli-home-[0-9a-f-]{36}", connection["runtimeRef"]):
            raise ValueError("Connection changed or does not belong to this host")
        name = "cli-login-" + provider
        # This container receives no worker environment, host credential, source mount
        # or app data. Its bridge network is used only for supervised native auth.
        engine.command(["create", "--name", name, "--label", "appraisal.cli-gateway=1",
                        "--interactive", "--tty", "--restart", "no", "--log-driver", "none",
                        "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
                        "--security-opt", "no-new-privileges", "--cpus", "1", "--memory", "2g", "--pids-limit", "128",
                        "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
                        "--tmpfs", "/work:rw,noexec,nosuid,size=32m,uid=1000,gid=1000",
                        "--mount", "type=volume,source=" + connection["runtimeRef"] + ",target=/home/agent",
                        # Codex creates ~/.codex in the generated native home.
                        # An explicit CODEX_HOME must already exist on this release.
                        "--network", "bridge", "--env", "HOME=/home/agent",
                        "--env", "LANG=C.UTF-8", "--env", "NO_BROWSER=true",
                        *(["--env", "AGY_CLI_DISABLE_AUTO_UPDATE=true"] if provider == "gemini" else []),
                        build["image"], *commands[provider]])
        code = None
        try:
            code = subprocess.run([engine.executable, "start", "--attach", "--interactive", name],
                                  env=engine.env, timeout=310, check=False).returncode
        except subprocess.TimeoutExpired:
            code = 124
        finally:
            engine.stop(name)
            engine.remove(name)
        if code == 124:
            print("The five-minute login window expired. The container stopped; the connection stays pending.", flush=True)
        elif code:
            print("Native login exited unsuccessfully. The container stopped; the connection stays pending.", flush=True)
        else:
            print("Native login container stopped. Connection stays pending until G1/G2 verification.", flush=True)


if __name__ == "__main__":
    main()
