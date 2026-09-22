from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Attachment:
    """A local file explicitly selected by the appraiser for the section agent."""

    path: Path
    name: str
    suffix: str


@dataclass(frozen=True)
class SectionRequest:
    """The fixed, user-facing inputs shared by the first POC sections."""

    section_id: str
    address: str
    example: str
    provider: str = "placeholder"
    additional_request: str = ""
    example_attachments: tuple[Attachment, ...] = ()
    additional_request_attachments: tuple[Attachment, ...] = ()


@dataclass(frozen=True)
class AgentResult:
    """A stable result shape for dummy and future production agents."""

    output_text: str
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)
