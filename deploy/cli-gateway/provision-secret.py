"""Generate a file-only host credential; print only its SHA-256 registration hash."""
import hashlib
import os
from pathlib import Path
import secrets
import sys

path = Path(sys.argv[1])
token = secrets.token_urlsafe(32)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    stream.write(token)
    stream.flush()
    os.fsync(stream.fileno())
print(hashlib.sha256(token.encode()).hexdigest())
