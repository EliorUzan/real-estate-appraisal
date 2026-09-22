from __future__ import annotations

from dataclasses import dataclass

from appraisal_assistant.infrastructure.provider_settings import ProviderSettingsStore


@dataclass(frozen=True)
class GeminiSettings:
    """Runtime-only Gemini configuration; no secret is stored in the project."""

    api_key: str | None
    model: str | None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    @classmethod
    def from_runtime(cls) -> "GeminiSettings":
        api_key, model = ProviderSettingsStore().load("gemini")
        return cls(api_key=api_key, model=model)
