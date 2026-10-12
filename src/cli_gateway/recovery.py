import json
import os
from pathlib import Path


class Journal:
    """Identity-only crash journal. Never persists prompt or generated output."""
    def __init__(self, directory):
        if Path(directory).is_symlink():
            raise ValueError("Journal may not be a symlink")
        self.directory = Path(directory).resolve()
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise ValueError("Journal may not be a symlink")
        os.chmod(self.directory, 0o700)
        self.path = self.directory / "attempt.json"

    def save(self, value):
        tmp = self.directory / "attempt.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, self.path)
        fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def load(self):
        if not self.path.exists():
            return None
        if self.path.is_symlink():
            raise ValueError("Journal may not be a symlink")
        return json.loads(self.path.read_text(encoding="utf-8"))

    def clear(self):
        self.path.unlink(missing_ok=True)
