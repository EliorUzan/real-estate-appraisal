from __future__ import annotations

from dataclasses import dataclass

from appraisal_assistant.infrastructure.provider_settings import ProviderSettingsStore


@dataclass(frozen=True)
class OpenAISettings:
    """Runtime-only OpenAI configuration; no secret is stored in the project."""

    api_key: str | None
    model: str | None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    @classmethod
    def from_runtime(cls) -> "OpenAISettings":
        api_key, model = ProviderSettingsStore().load("openai")
        return cls(api_key=api_key, model=model)
