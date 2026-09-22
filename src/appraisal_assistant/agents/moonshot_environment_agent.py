from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from appraisal_assistant.agents.prompts.environment_description import SYSTEM_INSTRUCTIONS, build_user_message
from appraisal_assistant.domain.models import AgentResult, Attachment, SectionRequest
from appraisal_assistant.infrastructure.moonshot_settings import MoonshotSettings
from appraisal_assistant.services.file_text_extractor import FileTextExtractor


class MoonshotConfigurationError(RuntimeError):
    pass


@dataclass
class MoonshotEnvironmentDescriptionAgent:
    """Moonshot's OpenAI-compatible Chat Completions transport."""

    settings: MoonshotSettings
    client_factory: Callable[..., Any] | None = None
    section_id: str = "environment_description"

    def run(self, request: SectionRequest) -> AgentResult:
        if not self.settings.is_configured:
            raise MoonshotConfigurationError("חסרה הגדרת Kimi. יש להגדיר MOONSHOT_API_KEY ו-MOONSHOT_MODEL.")
        user_message, warnings = self._build_user_message(request)
        try:
            response = self._create_client().chat.completions.create(
                model=self.settings.model,
                messages=[
                    {"role": "system", "content": SYSTEM_INSTRUCTIONS},
                    {"role": "user", "content": user_message},
                ],
            )
        except Exception as error:
            raise RuntimeError(f"הקריאה לסוכן Kimi נכשלה: {error}") from error
        output_text = str(response.choices[0].message.content or "").strip()
        if not output_text:
            raise RuntimeError("הסוכן Kimi לא החזיר טקסט.")
        return AgentResult(
            output_text=f"מודל: {self.settings.model}\n\n{output_text}",
            warnings=warnings,
            metadata={"agent": self.__class__.__name__, "mode": "moonshot", "model": self.settings.model or ""},
        )

    def _create_client(self) -> Any:
        if self.client_factory is not None:
            return self.client_factory(api_key=self.settings.api_key, base_url="https://api.moonshot.ai/v1")
        try:
            from openai import OpenAI
        except ImportError as error:
            raise MoonshotConfigurationError("חסרה ספריית OpenAI התואמת ל-Kimi. יש להריץ pip install -e \".[dev]\".") from error
        return OpenAI(api_key=self.settings.api_key, base_url="https://api.moonshot.ai/v1")

    @staticmethod
    def _build_user_message(request: SectionRequest) -> tuple[str, list[str]]:
        message = build_user_message(request.address, request.example, request.additional_request)
        warnings: list[str] = []
        extractor = FileTextExtractor()
        for attachment in (*request.example_attachments, *request.additional_request_attachments):
            try:
                text = extractor.extract_text(attachment.path)
            except Exception as error:
                warnings.append(f"הקובץ {attachment.name} לא נשלח ל-Kimi: לא ניתן להמיר אותו לטקסט ({error}).")
            else:
                message += f"\n\nתוכן הקובץ {attachment.name}:\n{text}"
        return message, warnings
