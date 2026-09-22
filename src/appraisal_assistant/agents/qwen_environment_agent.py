from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from appraisal_assistant.agents.prompts.environment_description import SYSTEM_INSTRUCTIONS, build_user_message
from appraisal_assistant.domain.models import AgentResult, Attachment, SectionRequest
from appraisal_assistant.infrastructure.qwen_settings import QwenSettings
from appraisal_assistant.services.file_text_extractor import FileTextExtractor


class QwenConfigurationError(RuntimeError):
    pass


@dataclass
class QwenEnvironmentDescriptionAgent:
    """DashScope's OpenAI-compatible Chat Completions transport."""

    settings: QwenSettings
    client_factory: Callable[..., Any] | None = None
    section_id: str = "environment_description"

    def run(self, request: SectionRequest) -> AgentResult:
        if not self.settings.is_configured:
            raise QwenConfigurationError("חסרה הגדרת Qwen. יש להגדיר DASHSCOPE_API_KEY ו-DASHSCOPE_MODEL.")
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
            raise RuntimeError(f"הקריאה לסוכן Qwen נכשלה: {error}") from error
        output_text = str(response.choices[0].message.content or "").strip()
        if not output_text:
            raise RuntimeError("הסוכן Qwen לא החזיר טקסט.")
        return AgentResult(
            output_text=f"מודל: {self.settings.model}\n\n{output_text}",
            warnings=warnings,
            metadata={"agent": self.__class__.__name__, "mode": "qwen", "model": self.settings.model or ""},
        )

    def _create_client(self) -> Any:
        if self.client_factory is not None:
            return self.client_factory(api_key=self.settings.api_key, base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
        try:
            from openai import OpenAI
        except ImportError as error:
            raise QwenConfigurationError("חסרה ספריית OpenAI התואמת ל-Qwen. יש להריץ pip install -e \".[dev]\".") from error
        return OpenAI(api_key=self.settings.api_key, base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1")

    @staticmethod
    def _build_user_message(request: SectionRequest) -> tuple[str, list[str]]:
        message = build_user_message(request.address, request.example, request.additional_request)
        warnings: list[str] = []
        extractor = FileTextExtractor()
        for attachment in (*request.example_attachments, *request.additional_request_attachments):
            try:
                text = extractor.extract_text(attachment.path)
            except Exception as error:
                warnings.append(f"הקובץ {attachment.name} לא נשלח ל-Qwen: לא ניתן להמיר אותו לטקסט ({error}).")
            else:
                message += f"\n\nתוכן הקובץ {attachment.name}:\n{text}"
        return message, warnings
