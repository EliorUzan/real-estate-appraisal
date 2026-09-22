from __future__ import annotations

from appraisal_assistant.domain.models import AgentResult, SectionRequest
from appraisal_assistant.services.file_text_extractor import FileTextExtractor


class PlaceholderEnvironmentDescriptionAgent:
    """Temporary designated agent for the environment-description section.

    It is deliberately deterministic. A future Gemini-backed agent can replace
    this class without changing the GUI, router, or attachment contract.
    """

    section_id = "environment_description"

    def run(self, request: SectionRequest) -> AgentResult:
        previews, extraction_warnings = self._attachment_previews(request)
        return AgentResult(
            output_text=(
                "סוכן מציין מקום — תיאור סביבת הנכס\n\n"
                "חמש המילים הראשונות בכל קובץ מצורף:\n"
                f"{previews}\n\n"
                "מקס ורסטאפן חוצה את המסלול כברק,\n"
                "ובכל פנייה משאיר ליריביו אבק."
            ),
            warnings=[
                "סוכן מציין מקום פעיל: לא בוצע איסוף מידע, אימות כתובת או ניסוח מקצועי.",
                *extraction_warnings,
            ],
            metadata={"agent": self.__class__.__name__, "mode": "placeholder"},
        )

    @staticmethod
    def _attachment_previews(request: SectionRequest) -> tuple[str, list[str]]:
        attachments = (*request.example_attachments, *request.additional_request_attachments)
        if not attachments:
            return "לא צורפו קבצים.", []
        extractor = FileTextExtractor()
        lines: list[str] = []
        warnings: list[str] = []
        for attachment in attachments:
            preview = extractor.first_words(attachment.path)
            lines.append(f"{attachment.name}: {preview.words}")
            if preview.warning:
                warnings.append(preview.warning)
        return "\n".join(lines), warnings
