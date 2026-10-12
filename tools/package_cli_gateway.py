"""Build a source-only worker archive for the authorized testing host."""
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parents[1]
files = list((root / "src/cli_gateway").rglob("*.py"))
files += list((root / "tests/cli_gateway").glob("test_*.py"))
files += [root / "deploy/cli-gateway" / name for name in (
    "Dockerfile.provider", "Dockerfile.antigravity", "watchdog.py", "claude-settings.json", "gemini-deny.toml",
    "gemini-settings.json", "antigravity-settings.json", "antigravity-text-agent.md", "antigravity-egress.json", "manifest.example.json", "requirements.txt", "README.md",
    "CODESPACES.md", "RESEARCH.md", "configure-maps.py", "bootstrap-ubuntu.sh", "provision-secret.py", "cli-gateway.service",
    "worker.env.example", "build-images.py", "releases.json", "native-login.py", "verify-native.py", "probe-research.py", "approve-research.py", "approve-personal.py", "resume-personal.py", "provision-egress.py", "verify-egress.py", "repair-codespaces-network.py", "CODESPACES_VERIFICATION.md",
    "login-manifest.example.json", "codespace-post-start.sh", "backup-runtime.py", "install-codespace-startup.py", "approve-rebuilt-runtime.py", "ONBOARDING.md")]
target = root / "artifacts/cli-gateway-worker.tar.gz"
target.parent.mkdir(exist_ok=True)
with tarfile.open(target, "w:gz") as archive:
    for path in sorted(files):
        if path.is_symlink() or not path.is_file():
            raise ValueError("Only regular allowlisted source files can be packaged")
        archive.add(path, arcname=str(path.relative_to(root)).replace("\\", "/"), recursive=False)
print(f"Source-only archive: {target.name} ({target.stat().st_size} bytes, {len(files)} files)")
