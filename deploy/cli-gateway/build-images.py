"""Build official pinned CLIs without credentials or model requests (Linux)."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

DIRECTORY = Path(__file__).resolve().parent
SOURCE_FILES = ("Dockerfile.provider", "Dockerfile.antigravity", "watchdog.py", "claude-settings.json", "gemini-deny.toml", "gemini-settings.json")


def docker(*args, capture=True):
    result = subprocess.run(["/usr/bin/docker", *args], check=True, timeout=900,
                            stdout=subprocess.PIPE if capture else None, text=True)
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Private host directory outside the source checkout")
    parser.add_argument("--provider", choices=("gemini", "openai", "claude", "all"), default="all")
    args = parser.parse_args()
    target = Path(args.output).resolve()
    repo = DIRECTORY.parents[1]
    if target == repo or repo in target.parents:
        raise ValueError("Build evidence belongs outside the Git checkout")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    releases = json.loads((DIRECTORY / "releases.json").read_text())
    docker("pull", releases["baseTag"], capture=False)
    base = json.loads(docker("image", "inspect", releases["baseTag"]))[0]["RepoDigests"][0]
    if not re.fullmatch(r"[^\s]+@sha256:[0-9a-f]{64}", base):
        raise ValueError("Base image was not resolved to an immutable registry digest")
    selected = releases["providers"] if args.provider == "all" else {args.provider: releases["providers"][args.provider]}
    for provider, release in selected.items():
        tag = "appraisal-cli-" + provider + ":" + release["version"]
        # Never send the application checkout, .env files or native homes to BuildKit.
        with tempfile.TemporaryDirectory(prefix="cli-build-") as folder:
            context = Path(folder)
            destination = context / "deploy/cli-gateway"
            destination.mkdir(parents=True)
            for name in SOURCE_FILES:
                source = DIRECTORY / name
                if source.is_symlink() or not source.is_file():
                    raise ValueError("Unexpected build source")
                shutil.copyfile(source, destination / name)
            if release.get("cliRuntime") == "antigravity":
                if provider != "gemini" or not re.fullmatch(r"[0-9a-f]{128}", release["sha512"]):
                    raise ValueError("Unsupported native binary release")
                docker("build", "--tag", tag, "--file", str(destination / "Dockerfile.antigravity"),
                       "--build-arg", "BASE_IMAGE=" + base,
                       "--build-arg", "CLI_URL=" + release["url"],
                       "--build-arg", "CLI_SHA512=" + release["sha512"], str(context), capture=False)
            else:
                docker("build", "--tag", tag, "--file", str(destination / "Dockerfile.provider"),
                       "--build-arg", "BASE_IMAGE=" + base,
                       "--build-arg", "CLI_PACKAGE=" + release["package"],
                       "--build-arg", "CLI_VERSION=" + release["version"],
                       "--build-arg", "CLI_INTEGRITY=" + release["integrity"], str(context), capture=False)
        image = json.loads(docker("image", "inspect", tag))[0]
        version = docker("run", "--rm", "--network", "none", "--read-only", "--user", "1000:1000",
                         "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                         "--cpus", "1", "--memory", "2g", "--pids-limit", "128", "--log-driver", "none",
                         "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
                         "--tmpfs", "/home/agent:rw,noexec,nosuid,size=32m,uid=1000,gid=1000",
                         "--tmpfs", "/work:rw,noexec,nosuid,size=32m,uid=1000,gid=1000",
                         image["Id"], release["command"], "--version").strip()
        if release["version"] not in version:
            raise ValueError("Installed version does not match the pinned release")
        evidence = {"provider": provider, **release, "image": image["Id"], "base": base,
                    "architecture": image["Architecture"], "versionOutput": version,
                    "nativeAuthVerified": False, "isolationVerified": False}
        path = target / (provider + "-build.json")
        path.write_text(json.dumps(evidence, indent=2) + "\n")
        path.chmod(0o600)
        print(provider + " image built and version verified; login and G2 remain unverified", flush=True)


if __name__ == "__main__":
    main()
