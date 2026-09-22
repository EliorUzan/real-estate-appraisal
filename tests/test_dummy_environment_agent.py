from appraisal_assistant.agents.placeholder_environment_agent import PlaceholderEnvironmentDescriptionAgent
from appraisal_assistant.domain.models import Attachment, SectionRequest
from pathlib import Path


def test_placeholder_agent_returns_attachment_preview_and_poem(tmp_path) -> None:
    example_file = tmp_path / "example.txt"
    example_file.write_text("אחת שתיים שלוש ארבע חמש שש", encoding="utf-8")
    result = PlaceholderEnvironmentDescriptionAgent().run(
        SectionRequest(
            section_id="environment_description",
            address="רחוב התחייה 2, חדרה",
            example="טקסט לדוגמה",
            additional_request="בדיקה",
            example_attachments=(Attachment(example_file, "example.txt", ".txt"),),
            additional_request_attachments=(Attachment(Path("request.docx"), "request.docx", ".docx"),),
        )
    )

    assert "מקס ורסטאפן" in result.output_text
    assert "example.txt" in result.output_text
    assert "request.docx" in result.output_text
    assert "אחת שתיים שלוש ארבע חמש" in result.output_text
