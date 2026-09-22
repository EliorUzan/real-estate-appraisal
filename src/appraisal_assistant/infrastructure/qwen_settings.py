from __future__ import annotations

from dataclasses import dataclass

from appraisal_assistant.infrastructure.provider_settings import ProviderSettingsStore


@dataclass(frozen=True)
class QwenSettings:
    api_key: str | None
    model: str | None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.model)

    @classmethod
    def from_runtime(cls) -> "QwenSettings":
        api_key, model = ProviderSettingsStore().load("qwen")
        return cls(api_key=api_key, model=model)
