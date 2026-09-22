from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderDefinition:
    identifier: str
    label: str
    api_key_environment_name: str
    model_environment_name: str
    model_options: tuple[tuple[str, str], ...]


PROVIDERS: dict[str, ProviderDefinition] = {
    "openai": ProviderDefinition(
        "openai", "ChatGPT (OpenAI)", "OPENAI_API_KEY", "OPENAI_MODEL",
        (
            ("GPT-5.6 Sol", "gpt-5.6-sol"),
            ("GPT-5.6 Terra", "gpt-5.6-terra"),
            ("GPT-5.6 Luna", "gpt-5.6-luna"),
            ("GPT-5.5", "gpt-5.5"),
            ("GPT-5.4", "gpt-5.4"),
            ("GPT-5.4 mini", "gpt-5.4-mini"),
            ("GPT-5.4 nano", "gpt-5.4-nano"),
            ("o3", "o3"),
            ("o3-pro", "o3-pro"),
            ("o4-mini", "o4-mini"),
            ("GPT-5.3-Codex", "gpt-5.3-codex"),
        ),
    ),
    "gemini": ProviderDefinition(
        "gemini", "Gemini", "GEMINI_API_KEY", "GEMINI_MODEL",
        (
            ("Gemini 3.8 Flash", "gemini-3.8-flash"),
            ("Gemini 3.1 Pro", "gemini-3.1-pro-preview"),
            ("Gemini 3.5 Flash-Lite", "gemini-3.5-flash-lite"),
            ("Gemini 3.7 Flash", "gemini-3.7-flash"),
            ("Gemini 3.6 Flash", "gemini-3.6-flash"),
            ("Gemini 3.5 Flash", "gemini-3.5-flash"),
            ("Gemini 2.5 Flash", "gemini-2.5-flash"),
        ),
    ),
    "anthropic": ProviderDefinition(
        "anthropic", "Claude (Anthropic)", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
        (
            ("Claude Fable 5", "claude-fable-5"),
            ("Claude Opus 5", "claude-opus-5"),
            ("Claude Sonnet 5", "claude-sonnet-5"),
            ("Claude Haiku 4.5", "claude-haiku-4-5-20251001"),
        ),
    ),
    "moonshot": ProviderDefinition(
        "moonshot", "Kimi (Moonshot)", "MOONSHOT_API_KEY", "MOONSHOT_MODEL",
        (
            ("Kimi K3 (Multimodal Reasoning)", "kimi-k3"),
            ("Kimi K2 Thinking", "kimi-k2-thinking"),
            ("Kimi K2.5", "kimi-k2.5"),
            ("Kimi K2.7 Code", "kimi-k2.7-code"),
            ("Kimi K2.6", "kimi-k2.6"),
            ("Kimi K2 Instruct", "kimi-k2-instruct"),
            ("Moonshot V1 (8K Context)", "moonshot-v1-8k"),
            ("Moonshot V1 (32K Context)", "moonshot-v1-32k"),
            ("Moonshot V1 (128K Context)", "moonshot-v1-128k"),
        ),
    ),
    "qwen": ProviderDefinition(
        "qwen", "Qwen (DashScope)", "DASHSCOPE_API_KEY", "DASHSCOPE_MODEL",
        (
            ("Qwen 3.8 Max", "qwen3.8-max"),
            ("Qwen 3.7 Max", "qwen3.7-max"),
            ("Qwen 3.7 Plus (Thinking)", "qwen3.7-plus"),
            ("Qwen 3.6 Flash", "qwen3.6-flash"),
            ("Qwen Max (Latest alias)", "qwen3-max-2026-01-23"),
            ("Qwen 3 Coder Plus", "qwen3-coder-plus"),
            ("Qwen 3 Coder Next", "qwen3-coder-next"),
            ("Qwen MT Plus", "qwen-mt-plus"),
            ("Qwen MT Flash", "qwen-mt-flash"),
        ),
    ),
}


class ProviderSettingsError(RuntimeError):
    pass


class ProviderSettingsStore:
    """Stores provider keys in the OS credential store, never in this project."""

    service_name = "RealEstateAppraisalAssistant"
    default_provider_key = "default_provider"

    @staticmethod
    def _key_name(provider: str, kind: str) -> str:
        return f"{provider}:{kind}"

    @staticmethod
    def _keyring():
        try:
            import keyring
        except ImportError as error:
            raise ProviderSettingsError("חסרה ספריית שמירת המפתחות. יש להריץ pip install -e \".[dev]\".") from error
        return keyring

    def load(self, provider: str) -> tuple[str | None, str | None]:
        definition = PROVIDERS[provider]
        try:
            keyring = self._keyring()
            saved_api_key = keyring.get_password(self.service_name, self._key_name(provider, "api_key"))
            saved_model = keyring.get_password(self.service_name, self._key_name(provider, "model"))
        except ProviderSettingsError:
            saved_api_key, saved_model = None, None
        except Exception:
            saved_api_key, saved_model = None, None
        return (
            saved_api_key or os.environ.get(definition.api_key_environment_name) or None,
            saved_model or os.environ.get(definition.model_environment_name) or None,
        )

    def save(self, provider: str, api_key: str | None, model: str) -> None:
        if not model.strip():
            raise ProviderSettingsError("יש לבחור או להקליד מזהה מודל.")
        keyring = self._keyring()
        try:
            if api_key and api_key.strip():
                keyring.set_password(self.service_name, self._key_name(provider, "api_key"), api_key.strip())
            keyring.set_password(self.service_name, self._key_name(provider, "model"), model.strip())
        except Exception as error:
            raise ProviderSettingsError(f"לא ניתן לשמור את ההגדרות ב-Windows: {error}") from error

    def load_default_provider(self) -> str:
        try:
            stored_provider = self._keyring().get_password(self.service_name, self.default_provider_key)
        except Exception:
            return "openai"
        return stored_provider if stored_provider in PROVIDERS else "openai"

    def save_default_provider(self, provider: str) -> None:
        if provider not in PROVIDERS:
            raise ProviderSettingsError("ספק ברירת המחדל אינו תקין.")
        try:
            self._keyring().set_password(self.service_name, self.default_provider_key, provider)
        except Exception as error:
            raise ProviderSettingsError(f"לא ניתן לשמור את ספק ברירת המחדל ב-Windows: {error}") from error

    def has_saved_api_key(self, provider: str) -> bool:
        keyring = self._keyring()
        try:
            return bool(keyring.get_password(self.service_name, self._key_name(provider, "api_key")))
        except Exception:
            return False
