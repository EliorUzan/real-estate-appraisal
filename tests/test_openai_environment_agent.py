from types import SimpleNamespace

from appraisal_assistant.agents.openai_environment_agent import OpenAIEnvironmentDescriptionAgent
from appraisal_assistant.domain.models import Attachment, SectionRequest
from appraisal_assistant.infrastructure.openai_settings import OpenAISettings


class FakeResponses:
    def __init__(self) -> None:
        self.call = None

    def create(self, **kwargs):
        self.call = kwargs
        return SimpleNamespace(output_text="פלט בדיקה")


class FakeClient:
    def __init__(self) -> None:
        self.responses = FakeResponses()


def test_openai_agent_sends_selected_file_and_returns_response(tmp_path) -> None:
    attachment_path = tmp_path / "reference.txt"
    attachment_path.write_text("one two three four five", encoding="utf-8")
    client = FakeClient()
    agent = OpenAIEnvironmentDescriptionAgent(
        OpenAISettings(api_key="test-key", model="test-model"),
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

    parts = client.responses.call["input"][0]["content"]
    assert result.output_text == "מודל: test-model\n\nפלט בדיקה"
    assert client.responses.call["model"] == "test-model"
    file_part = next(part for part in parts if part["type"] == "input_file")
    assert file_part["filename"] == "reference.txt"
    assert file_part["file_data"].startswith("data:text/plain;base64,")
