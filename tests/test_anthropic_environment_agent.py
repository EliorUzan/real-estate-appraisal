from types import SimpleNamespace

from appraisal_assistant.agents.anthropic_environment_agent import AnthropicEnvironmentDescriptionAgent
from appraisal_assistant.domain.models import Attachment, SectionRequest
from appraisal_assistant.infrastructure.anthropic_settings import AnthropicSettings


class FakeMessages:
    def __init__(self) -> None:
        self.call = None

    def create(self, **kwargs):
        self.call = kwargs
        return SimpleNamespace(content=[SimpleNamespace(text="פלט בדיקה")])


class FakeClient:
    def __init__(self) -> None:
        self.messages = FakeMessages()


def test_anthropic_agent_sends_selected_file_and_identifies_model(tmp_path) -> None:
    attachment_path = tmp_path / "reference.pdf"
    attachment_path.write_bytes(b"%PDF-1.4 test")
    client = FakeClient()
    agent = AnthropicEnvironmentDescriptionAgent(
        AnthropicSettings(api_key="test-key", model="test-model"),
        client_factory=lambda **_kwargs: client,
    )

    result = agent.run(SectionRequest(
        section_id="environment_description", address="רחוב התחייה 2, חדרה", example="text",
        example_attachments=(Attachment(attachment_path, "reference.pdf", ".pdf"),),
    ))

    parts = client.messages.call["messages"][0]["content"]
    assert result.output_text == "מודל: test-model\n\nפלט בדיקה"
    assert client.messages.call["model"] == "test-model"
    assert next(part for part in parts if part["type"] == "document")["title"] == "reference.pdf"
