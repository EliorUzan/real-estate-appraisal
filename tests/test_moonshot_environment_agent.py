from types import SimpleNamespace

from appraisal_assistant.agents.moonshot_environment_agent import MoonshotEnvironmentDescriptionAgent
from appraisal_assistant.domain.models import SectionRequest
from appraisal_assistant.infrastructure.moonshot_settings import MoonshotSettings


class FakeCompletions:
    def __init__(self) -> None:
        self.call = None

    def create(self, **kwargs):
        self.call = kwargs
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="פלט בדיקה"))])


class FakeClient:
    def __init__(self) -> None:
        self.chat = SimpleNamespace(completions=FakeCompletions())


def test_moonshot_agent_uses_selected_model() -> None:
    client = FakeClient()
    agent = MoonshotEnvironmentDescriptionAgent(
        MoonshotSettings(api_key="test-key", model="kimi-k3"),
        client_factory=lambda **_kwargs: client,
    )

    result = agent.run(SectionRequest(
        section_id="environment_description", address="רחוב התחייה 2, חדרה", example="טקסט לדוגמה",
    ))

    assert result.output_text == "מודל: kimi-k3\n\nפלט בדיקה"
    assert client.chat.completions.call["model"] == "kimi-k3"
