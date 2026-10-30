from types import SimpleNamespace

import pytest

from api import auth
from api.errors import ApiError


def test_oversized_token_rejected_before_jwks(monkeypatch):
    def unexpected_jwks(_):
        raise AssertionError("Oversized input reached the key lookup")

    monkeypatch.setattr(auth, "jwks_client", unexpected_jwks)
    with pytest.raises(ApiError) as failure:
        auth.require_user("Bearer " + "x" * 20_000, SimpleNamespace(supabase_jwks_url="unused"))
    assert failure.value.status_code == 401


def test_recursive_payload_is_an_invalid_session(monkeypatch):
    class RecursivePayload:
        def get_signing_key_from_jwt(self, _):
            raise RecursionError("Synthetic malformed token")

    monkeypatch.setattr(auth, "jwks_client", lambda _: RecursivePayload())
    with pytest.raises(ApiError) as failure:
        auth.require_user("Bearer fixture-token", SimpleNamespace(supabase_jwks_url="unused"))
    assert failure.value.status_code == 401
    assert failure.value.code == "INVALID_SESSION"
