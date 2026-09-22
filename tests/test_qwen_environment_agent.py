from types import SimpleNamespace

from appraisal_assistant.agents.qwen_environment_agent import QwenEnvironmentDescriptionAgent
from appraisal_assistant.domain.models import SectionRequest
from appraisal_assistant.infrastructure.qwen_settings import QwenSettings


class FakeCompletions:
    def __init__(self) -> None:
        self.call = None

    def create(self, **kwargs):
        self.call = kwargs
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="פלט בדיקה"))])


class FakeClient:
    def __init__(self) -> None:
        self.chat = SimpleNamespace(completions=FakeCompletions())


def test_qwen_agent_uses_selected_model() -> None:
    client = FakeClient()
    agent = QwenEnvironmentDescriptionAgent(
        QwenSettings(api_key="test-key", model="qwen3.8-max"),
        client_factory=lambda **_kwargs: client,
    )

    result = agent.run(SectionRequest(
        section_id="environment_description", address="רחוב התחייה 2, חדרה", example="טקסט לדוגמה",
    ))

    assert result.output_text == "מודל: qwen3.8-max\n\nפלט בדיקה"
    assert client.chat.completions.call["model"] == "qwen3.8-max"
