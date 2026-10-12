"""Synthetic engine check. Never mounts native credentials or invokes a model."""
import argparse
import json
import os
import re
import subprocess
import uuid
from .contracts import GatewayError
from .runner import Docker


def check(engine, image, personal_codespaces=False):
    if not re.fullmatch(r"[^\s]+@sha256:[0-9a-f]{64}", image):
        raise GatewayError("PROBE_IMAGE_NOT_PINNED")
    if engine.inventory():
        raise GatewayError("STOP_GATEWAY_BEFORE_PREFLIGHT")
    info = json.loads(engine.command(["info", "--format", "{{json .}}"] ))
    if personal_codespaces:
        if os.environ.get("CODESPACES") != "true":
            raise GatewayError("CODESPACES_REQUIRED")
        if str(info.get("CgroupVersion")) != "2" or info.get("CgroupDriver") not in {"cgroupfs", "systemd"}:
            raise GatewayError("CGROUP_V2_REQUIRED")
    else:
        if not any("rootless" in item for item in info.get("SecurityOptions", [])):
            raise GatewayError("ROOTLESS_ENGINE_REQUIRED")
        if str(info.get("CgroupVersion")) != "2" or info.get("CgroupDriver") != "systemd":
            raise GatewayError("ROOTLESS_CGROUP_DELEGATION_REQUIRED")
    name = "cli-preflight-" + str(uuid.uuid4())
    # Shell is used only in this fixed synthetic probe, never with submitted text.
    script = """set -eu
test "$(id -u)" = 1000
test "$(cat /sys/fs/cgroup/memory.max)" = 67108864
test "$(cat /sys/fs/cgroup/pids.max)" = 32
test "$(cat /sys/fs/cgroup/cpu.max)" = '50000 100000'
case ",$(awk '$2 == "/" {print $4}' /proc/mounts)," in *,ro,*) ;; *) exit 1 ;; esac
if touch /forbidden 2>/dev/null; then exit 1; fi
test -z "$(ls /home 2>/dev/null)"
printf 'ENGINE_PROBE_OK'
"""
    output = engine.command(["run", "--rm", "--name", name,
        "--label", "appraisal.cli-preflight=1", "--network", "none",
        "--user", "1000:1000", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--cpus", "0.5",
        "--memory", "64m", "--pids-limit", "32", "--log-driver", "none",
        image, "sh", "-c", script], timeout=60)
    if output != b"ENGINE_PROBE_OK":
        raise GatewayError("RESOURCE_ISOLATION_PROBE_FAILED")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Official Alpine image pinned by digest")
    parser.add_argument("--personal-codespaces", action="store_true", help="Test Codespaces' own Docker daemon; restricted to one personal native home")
    args = parser.parse_args()
    try:
        check(Docker(), args.image, args.personal_codespaces)
    except (GatewayError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        print("Preflight failed: " + (error.code if isinstance(error, GatewayError) else "ENGINE_CHECK_FAILED"))
        raise SystemExit(1) from None
    print("Synthetic engine checks passed. Native login and provider G2 remain unverified.")


if __name__ == "__main__":
    main()
