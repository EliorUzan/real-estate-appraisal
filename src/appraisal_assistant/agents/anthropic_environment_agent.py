from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Callable

from appraisal_assistant.agents.prompts.environment_description import SYSTEM_INSTRUCTIONS, build_user_message
from appraisal_assistant.domain.models import AgentResult, Attachment, SectionRequest
from appraisal_assistant.infrastructure.anthropic_settings import AnthropicSettings
from appraisal_assistant.services.file_text_extractor import FileTextExtractor


MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024


class AnthropicConfigurationError(RuntimeError):
    pass


@dataclass
class AnthropicEnvironmentDescriptionAgent:
    """Anthropic Messages API transport for the environment-description section."""

    settings: AnthropicSettings
    client_factory: Callable[..., Any] | None = None
    section_id: str = "environment_description"

    def run(self, request: SectionRequest) -> AgentResult:
        if not self.settings.is_configured:
            raise AnthropicConfigurationError("חסרה הגדרת Claude. יש להגדיר ANTHROPIC_API_KEY ו-ANTHROPIC_MODEL.")
        content, warnings = self._build_content(request)
        try:
            response = self._create_client().messages.create(
                model=self.settings.model,
                max_tokens=1_000,
                system=SYSTEM_INSTRUCTIONS,
                messages=[{"role": "user", "content": content}],
            )
        except Exception as error:
            raise RuntimeError(f"הקריאה לסוכן Claude נכשלה: {error}") from error
        output_text = self._response_text(response)
        if not output_text:
            raise RuntimeError("הסוכן Claude לא החזיר טקסט.")
        return AgentResult(
            output_text=f"מודל: {self.settings.model}\n\n{output_text}",
            warnings=warnings,
            metadata={"agent": self.__class__.__name__, "mode": "anthropic", "model": self.settings.model or ""},
        )

    def _create_client(self) -> Any:
        if self.client_factory is not None:
            return self.client_factory(api_key=self.settings.api_key)
        try:
            import anthropic
        except ImportError as error:
            raise AnthropicConfigurationError("חסרה ספריית Anthropic. יש להריץ pip install -e \".[dev]\".") from error
        return anthropic.Anthropic(api_key=self.settings.api_key)

    def _build_content(self, request: SectionRequest) -> tuple[list[dict[str, Any]], list[str]]:
        content: list[dict[str, Any]] = [{"type": "text", "text": build_user_message(request.address, request.example, request.additional_request)}]
        warnings: list[str] = []
        for attachment in (*request.example_attachments, *request.additional_request_attachments):
            part, warning = self._file_part(attachment)
            if part:
                content.append(part)
            if warning:
                warnings.append(warning)
        return content, warnings

    @staticmethod
    def _file_part(attachment: Attachment) -> tuple[dict[str, Any] | None, str | None]:
        try:
            size = attachment.path.stat().st_size
            if size > MAX_ATTACHMENT_BYTES:
                return None, f"הקובץ {attachment.name} לא נשלח: גודלו עולה על 20MB."
        except OSError:
            return None, f"הקובץ {attachment.name} לא נשלח: לא ניתן לקרוא אותו מהמחשב."
        if attachment.suffix == ".pdf":
            try:
                encoded = base64.b64encode(attachment.path.read_bytes()).decode("ascii")
            except OSError:
                return None, f"הקובץ {attachment.name} לא נשלח: לא ניתן לקרוא אותו מהמחשב."
            return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": encoded}, "title": attachment.name}, None
        try:
            extracted_text = FileTextExtractor().extract_text(attachment.path)
        except Exception as error:
            return None, f"הקובץ {attachment.name} לא נשלח ל-Claude: לא ניתן להמיר אותו לטקסט ({error})."
        return {"type": "text", "text": f"\n\nתוכן הקובץ {attachment.name}:\n{extracted_text}"}, None

    @staticmethod
    def _response_text(response: Any) -> str:
        parts = getattr(response, "content", [])
        return "\n".join(
            str(getattr(part, "text", "") or (part.get("text", "") if isinstance(part, dict) else ""))
            for part in parts
        ).strip()
