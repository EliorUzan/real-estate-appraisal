from __future__ import annotations

from typing import Protocol

from appraisal_assistant.domain.models import AgentResult, SectionRequest


class SectionAgent(Protocol):
    """Contract used by each designated report-section agent."""

    section_id: str

    def run(self, request: SectionRequest) -> AgentResult:
        """Produce a result for one report section."""
