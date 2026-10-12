"""Ephemeral browser-to-supervisor sealed envelopes; never persist private keys."""
import base64
import json
import re
import uuid
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .contracts import GatewayError

ALGORITHM = "RSA-OAEP-3072-SHA256+A256GCM"


def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def decode(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise GatewayError("INVALID_CODE")
    try:
        result = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except ValueError:
        raise GatewayError("INVALID_CODE") from None
    if encode(result) != value:
        raise GatewayError("INVALID_CODE")
    return result


def normalize_code(value):
    if not isinstance(value, str):
        raise GatewayError("INVALID_CODE")
    code = value.strip(" \r\n")
    if not 1 <= len(code) <= 8192 or not re.fullmatch(r"[!-~]+", code) or "://" in code or code.startswith(("{", "[")):
        raise GatewayError("INVALID_CODE")
    return code


class LoginKey:
    def __init__(self):
        self.key_id = str(uuid.uuid4())
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=3072)

    def public_jwk(self):
        numbers = self.private.public_key().public_numbers()
        return {"kty": "RSA", "n": encode(numbers.n.to_bytes(384, "big")), "e": "AQAB",
                "alg": "RSA-OAEP-256", "key_ops": ["wrapKey"], "ext": True}

    def decrypt(self, envelope, session_id, revision, challenge_id, submission_id, purpose="antigravity-login"):
        try:
            if (not isinstance(envelope, dict) or set(envelope) != {"version", "algorithm", "keyId", "wrappedKey", "iv", "ciphertext"}
                or envelope["version"] != 1 or envelope["algorithm"] != ALGORITHM or envelope["keyId"] != self.key_id):
                raise ValueError()
            wrapped, iv, ciphertext = (decode(envelope[k]) for k in ("wrappedKey", "iv", "ciphertext"))
            if len(wrapped) != 384 or len(iv) != 12 or not 17 <= len(ciphertext) <= 8208:
                raise ValueError()
            key = self.private.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
            if len(key) != 32:
                raise ValueError()
            context = json.dumps([1, purpose, session_id, revision, challenge_id, submission_id, self.key_id], separators=(",", ":"), ensure_ascii=False).encode()
            value = AESGCM(key).decrypt(iv, ciphertext, context).decode("utf-8", "strict")
            return normalize_code(value)
        except Exception:
            # No ciphertext, key, code or cryptographic exception in diagnostics.
            raise GatewayError("INVALID_CODE") from None
