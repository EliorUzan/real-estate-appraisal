from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, Header
from jwt import PyJWKClient

from api.config import Settings, get_settings
from api.errors import ApiError


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    email: str | None


@lru_cache(maxsize=4)
def jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(url, cache_keys=True, lifespan=300)


def require_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
    """Validate a Supabase access token without trusting browser-supplied identity fields."""

    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(401, "UNAUTHENTICATED", "נדרש להתחבר למערכת.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise ApiError(401, "UNAUTHENTICATED", "נדרש להתחבר למערכת.")
    try:
        signing_key = jwks_client(settings.supabase_jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=[signing_key.algorithm_name],
            audience="authenticated",
            issuer=f"{str(settings.supabase_url).rstrip('/')}/auth/v1",
            options={"require": ["sub", "exp", "aud", "iss"]},
        )
        return AuthenticatedUser(id=UUID(claims["sub"]), email=claims.get("email"))
    except (jwt.PyJWTError, ValueError):
        raise ApiError(401, "INVALID_SESSION", "תוקף ההתחברות פג. יש להתחבר מחדש.") from None
