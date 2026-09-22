import pytest

from appraisal_assistant.application.agent_router import AgentRouter, SectionNotAvailableError
from appraisal_assistant.domain.models import SectionRequest


def test_active_section_uses_dummy_agent() -> None:
    result = AgentRouter().run(
        SectionRequest(
            section_id="environment_description",
            address="רחוב התחייה 2, חדרה",
            example="טקסט לדוגמה",
        )
    )

    assert "סוכן מציין מקום" in result.output_text
    assert result.metadata["mode"] == "placeholder"


def test_placeholder_section_cannot_run() -> None:
    request = SectionRequest(
        section_id="property_description",
        address="רחוב התחייה 2, חדרה",
        example="טקסט לדוגמה",
    )

    with pytest.raises(SectionNotAvailableError):
        AgentRouter().run(request)
