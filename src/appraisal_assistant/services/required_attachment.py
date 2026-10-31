"""Small shared boundary for required provider attachments."""
from pathlib import Path

MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

def read_required_bytes(path: Path) -> bytes:
    try:
        with path.open("rb") as stream:
            data = stream.read(MAX_ATTACHMENT_BYTES + 1)
    except OSError as error:
        raise ValueError(f"לא ניתן לקרוא את הקובץ {path.name}. בחרו קובץ קריא ונסו שוב.") from error
    if not data or len(data) > MAX_ATTACHMENT_BYTES:
        raise ValueError(f"הקובץ {path.name} ריק או גדול מ-20MB. יש לפצל או להמיר אותו ולנסות שוב.")
    return data

def require_readable_text(text: str, filename: str) -> str:
    if not text.strip():
        raise ValueError(f"לא נמצא טקסט קריא בקובץ {filename}. יש להמיר אותו לטקסט קריא או להסיר אותו ולנסות שוב.")
    return text
