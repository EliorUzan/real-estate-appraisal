import sys
from types import SimpleNamespace

from appraisal_assistant.infrastructure.provider_settings import ProviderSettingsStore


def test_saved_provider_settings_take_precedence_between_sessions(monkeypatch) -> None:
    values: dict[tuple[str, str], str] = {}

    def get_password(service: str, username: str) -> str | None:
        return values.get((service, username))

    def set_password(service: str, username: str, value: str) -> None:
        values[(service, username)] = value

    monkeypatch.setitem(sys.modules, "keyring", SimpleNamespace(get_password=get_password, set_password=set_password))
    monkeypatch.setenv("GEMINI_API_KEY", "environment-key")
    monkeypatch.setenv("GEMINI_MODEL", "environment-model")
    first_session = ProviderSettingsStore()
    first_session.save("gemini", "saved-key", "gemini-3.8-flash")
    first_session.save_default_provider("gemini")

    second_session = ProviderSettingsStore()
    assert second_session.load("gemini") == ("saved-key", "gemini-3.8-flash")
    assert second_session.load_default_provider() == "gemini"
