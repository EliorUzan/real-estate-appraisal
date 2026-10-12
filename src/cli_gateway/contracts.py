from dataclasses import dataclass
import hashlib
import json

MAX_STDOUT = 4 * 1024 * 1024
MAX_STDERR = 256 * 1024
MAX_EVENT = 1024 * 1024
MAX_ANSWER = 256 * 1024
HEARTBEAT_SECONDS = 10
LEASE_MARGIN_SECONDS = 15
RUNTIME_SECONDS = 300
ERROR_CODES = frozenset({"AUTH_REQUIRED", "PLAN_REQUIRED", "QUOTA_EXCEEDED", "TIMEOUT",
    "OUTPUT_LIMIT", "INVALID_OUTPUT", "CLI_FAILED", "ACCESS_REVOKED", "WORKER_LOST",
    "OUTCOME_UNCERTAIN", "CONNECTION_CHANGED", "CANCELLED"})


class GatewayError(Exception):
    def __init__(self, code: str, *, detail: str | None = None):
        self.code = code
        self.detail = detail
        super().__init__(code)


@dataclass(frozen=True)
class Result:
    text: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None

    def payload(self):
        return {"text": self.text, "model": self.model,
                "inputTokens": self.input_tokens, "outputTokens": self.output_tokens,
                "errorCode": self.error}


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                                    allow_nan=False).encode("utf-8")).hexdigest()


def answer(value):
    if not isinstance(value, str) or not value.strip():
        raise GatewayError("INVALID_OUTPUT")
    if len(value.encode("utf-8")) > MAX_ANSWER:
        raise GatewayError("OUTPUT_LIMIT", detail="answer_bytes")
    return value


def count(value):
    return value if type(value) is int and 0 <= value <= 10**12 else None


def model(value):
    return value if isinstance(value, str) and 0 < len(value) <= 160 else None
