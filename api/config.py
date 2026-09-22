from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Secrets come only from the deployment environment."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["local", "preview", "staging", "production"] = "local"
    allowed_origins: str = "http://localhost:5173"
    supabase_url: AnyHttpUrl | None = None
    supabase_publishable_key: SecretStr | None = None
    supabase_secret_key: SecretStr | None = None
    storage_bucket: str = "temporary-source-files"
    mock_providers: bool = True
    generation_enabled: bool = True
    max_attachment_bytes: int = Field(default=20 * 1024 * 1024, gt=0, le=20 * 1024 * 1024)
    max_job_bytes: int = Field(default=40 * 1024 * 1024, gt=0, le=40 * 1024 * 1024)

    @field_validator("allowed_origins")
    @classmethod
    def validate_origins(cls, value: str) -> str:
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        if not origins or any(origin == "*" for origin in origins):
            raise ValueError("ALLOWED_ORIGINS must contain explicit origins and cannot use '*'.")
        return ",".join(origins)

    @property
    def cors_origins(self) -> list[str]:
        return self.allowed_origins.split(",")

    @property
    def supabase_jwks_url(self) -> str:
        if self.supabase_url is None:
            raise RuntimeError("SUPABASE_URL is not configured")
        return f"{str(self.supabase_url).rstrip('/')}/auth/v1/.well-known/jwks.json"

    def require_runtime_secrets(self) -> None:
        if self.app_env == "production" and self.mock_providers:
            raise RuntimeError("MOCK_PROVIDERS must be false in production")
        if self.app_env != "local" and (
            self.supabase_url is None
            or self.supabase_publishable_key is None
            or self.supabase_secret_key is None
        ):
            raise RuntimeError("Supabase URL, publishable key, and server secret are required outside local development")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.require_runtime_secrets()
    return settings
