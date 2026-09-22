from __future__ import annotations

from dataclasses import dataclass

from appraisal_assistant.infrastructure.provider_settings import ProviderSettingsStore


@dataclass(frozen=True)
class MoonshotSettings:
    api_key: str | None
    model: str | None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    @classmethod
    def from_runtime(cls) -> "MoonshotSettings":
        api_key, model = ProviderSettingsStore().load("moonshot")
        return cls(api_key=api_key, model=model)
