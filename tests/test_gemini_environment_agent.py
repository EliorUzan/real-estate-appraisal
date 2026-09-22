from types import SimpleNamespace

from appraisal_assistant.agents.gemini_environment_agent import GeminiEnvironmentDescriptionAgent
from appraisal_assistant.domain.models import Attachment, SectionRequest
from appraisal_assistant.infrastructure.gemini_settings import GeminiSettings


class FakeInteractions:
    def __init__(self) -> None:
        self.call = None

    def create(self, **kwargs):
        self.call = kwargs
        return SimpleNamespace(output_text="פלט בדיקה")


class FakeClient:
    def __init__(self) -> None:
        self.interactions = FakeInteractions()


def test_gemini_agent_sends_selected_file_and_returns_response(tmp_path) -> None:
    attachment_path = tmp_path / "reference.txt"
    attachment_path.write_text("one two three four five", encoding="utf-8")
    client = FakeClient()
    agent = GeminiEnvironmentDescriptionAgent(
        GeminiSettings(api_key="test-key", model="test-model"),
        client_factory=lambda **_kwargs: client,
    )

    result = agent.run(
        SectionRequest(
            section_id="environment_description",
            address="רחוב התחייה 2, חדרה",
            example="text",
            example_attachments=(Attachment(attachment_path, "reference.txt", ".txt"),),
        )
    )

    parts = client.interactions.call["input"]
    assert result.output_text == "מודל: test-model\n\nפלט בדיקה"
    assert client.interactions.call["model"] == "test-model"
    file_part = next(part for part in parts if part["type"] == "document")
    assert file_part["mime_type"] == "text/plain"
    assert file_part["data"]
