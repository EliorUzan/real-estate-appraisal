from __future__ import annotations

from appraisal_assistant.agents.contracts import SectionAgent
from appraisal_assistant.agents.gemini_environment_agent import GeminiEnvironmentDescriptionAgent
from appraisal_assistant.agents.openai_environment_agent import OpenAIEnvironmentDescriptionAgent
from appraisal_assistant.agents.anthropic_environment_agent import AnthropicEnvironmentDescriptionAgent
from appraisal_assistant.agents.moonshot_environment_agent import MoonshotEnvironmentDescriptionAgent
from appraisal_assistant.agents.qwen_environment_agent import QwenEnvironmentDescriptionAgent
from appraisal_assistant.agents.placeholder_environment_agent import PlaceholderEnvironmentDescriptionAgent
from appraisal_assistant.domain.models import AgentResult, SectionRequest
from appraisal_assistant.domain.sections import section_by_id
from appraisal_assistant.infrastructure.gemini_settings import GeminiSettings
from appraisal_assistant.infrastructure.openai_settings import OpenAISettings
from appraisal_assistant.infrastructure.anthropic_settings import AnthropicSettings
from appraisal_assistant.infrastructure.provider_settings import PROVIDERS
from appraisal_assistant.infrastructure.moonshot_settings import MoonshotSettings
from appraisal_assistant.infrastructure.qwen_settings import QwenSettings


class SectionNotAvailableError(Exception):
    pass


class AgentRouter:
    """Routes each available report section to exactly one designated agent."""

    def __init__(self, agents: list[SectionAgent] | None = None) -> None:
        self._agents = {agent.section_id: agent for agent in agents} if agents else None
        self._providers = self._default_environment_agents() if agents is None else {}

    @staticmethod
    def _default_environment_agents() -> dict[str, SectionAgent]:
        providers: dict[str, SectionAgent] = {"placeholder": PlaceholderEnvironmentDescriptionAgent()}
        gemini_settings = GeminiSettings.from_runtime()
        if gemini_settings.is_configured:
            providers["gemini"] = GeminiEnvironmentDescriptionAgent(gemini_settings)
        openai_settings = OpenAISettings.from_runtime()
        if openai_settings.is_configured:
            providers["openai"] = OpenAIEnvironmentDescriptionAgent(openai_settings)
        anthropic_settings = AnthropicSettings.from_runtime()
        if anthropic_settings.is_configured:
            providers["anthropic"] = AnthropicEnvironmentDescriptionAgent(anthropic_settings)
        moonshot_settings = MoonshotSettings.from_runtime()
        if moonshot_settings.is_configured:
            providers["moonshot"] = MoonshotEnvironmentDescriptionAgent(moonshot_settings)
        qwen_settings = QwenSettings.from_runtime()
        if qwen_settings.is_configured:
            providers["qwen"] = QwenEnvironmentDescriptionAgent(qwen_settings)
        return providers

    def run(self, request: SectionRequest) -> AgentResult:
        section = section_by_id(request.section_id)
        if not section.is_available:
            raise SectionNotAvailableError(f"הסעיף \"{section.label}\" יתווסף בגרסה עתידית.")
        if self._agents is not None:
            agent = self._agents.get(request.section_id)
        else:
            agent = self._providers.get(request.provider)
        if agent is None:
            provider_name = PROVIDERS.get(request.provider).label if request.provider in PROVIDERS else request.provider
            raise RuntimeError(f"הספק {provider_name} לא מוגדר. יש להגדיר את מפתח ה-API ואת המודל שלו לפני השימוש.")
        return agent.run(request)

    def is_provider_configured(self, provider: str) -> bool:
        return provider in self._providers
