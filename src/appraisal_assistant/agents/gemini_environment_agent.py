from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from typing import Any, Callable

from appraisal_assistant.agents.prompts.environment_description import SYSTEM_INSTRUCTIONS, build_user_message
from appraisal_assistant.domain.models import AgentResult, Attachment, SectionRequest
from appraisal_assistant.infrastructure.gemini_settings import GeminiSettings


MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024


class GeminiConfigurationError(RuntimeError):
    pass


@dataclass
class GeminiEnvironmentDescriptionAgent:
    """Gemini transport for the environment-description section.

    This adapter intentionally owns only Gemini-specific request formatting. The
    appraisal prompt remains in ``agents/prompts`` so it can evolve separately.
    """

    settings: GeminiSettings
    client_factory: Callable[..., Any] | None = None
    section_id: str = "environment_description"

    def run(self, request: SectionRequest) -> AgentResult:
        if not self.settings.is_configured:
            raise GeminiConfigurationError("חסרה הגדרת Gemini. יש להגדיר GEMINI_API_KEY ו-GEMINI_MODEL.")
        client = self._create_client()
        content, warnings = self._build_content(request)
        try:
            interaction = client.interactions.create(model=self.settings.model, input=content)
        except Exception as error:
            raise RuntimeError(f"הקריאה לסוכן Gemini נכשלה: {error}") from error
        output_text = str(getattr(interaction, "output_text", "") or "").strip()
        if not output_text:
            raise RuntimeError("הסוכן Gemini לא החזיר טקסט.")
        return AgentResult(
            output_text=f"מודל: {self.settings.model}\n\n{output_text}",
            warnings=warnings,
            metadata={"agent": self.__class__.__name__, "mode": "gemini", "model": self.settings.model or ""},
        )

    def _create_client(self) -> Any:
        if self.client_factory is not None:
            return self.client_factory(api_key=self.settings.api_key)
        try:
            from google import genai
        except ImportError as error:
            raise GeminiConfigurationError("חסרה ספריית Gemini. יש להריץ pip install -e \".[dev]\".") from error
        return genai.Client(api_key=self.settings.api_key)

    def _build_content(self, request: SectionRequest) -> tuple[list[dict[str, str]], list[str]]:
        attachment_names = [
            attachment.name
            for attachment in (*request.example_attachments, *request.additional_request_attachments)
        ]
        prompt = f"{SYSTEM_INSTRUCTIONS}\n\n{build_user_message(request.address, request.example, request.additional_request)}"
        if attachment_names:
            prompt += "\n\nקבצים מצורפים שנשלחו: " + ", ".join(attachment_names)
        content: list[dict[str, str]] = [{"type": "text", "text": prompt}]
        warnings: list[str] = []
        for attachment in (*request.example_attachments, *request.additional_request_attachments):
            part, warning = self._file_part(attachment)
            if part:
                content.append(part)
            if warning:
                warnings.append(warning)
        return content, warnings

    @staticmethod
    def _file_part(attachment: Attachment) -> tuple[dict[str, str] | None, str | None]:
        try:
            size = attachment.path.stat().st_size
            if size > MAX_ATTACHMENT_BYTES:
                return None, f"הקובץ {attachment.name} לא נשלח: גודלו עולה על 20MB."
            encoded = base64.b64encode(attachment.path.read_bytes()).decode("ascii")
        except OSError:
            return None, f"הקובץ {attachment.name} לא נשלח: לא ניתן לקרוא אותו מהמחשב."
        mime_type = mimetypes.guess_type(attachment.name)[0] or "application/octet-stream"
        return {"type": "document", "data": encoded, "mime_type": mime_type}, None
