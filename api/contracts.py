from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


ProviderId = Literal["openai", "gemini", "anthropic", "moonshot", "qwen"]
AttachmentGroup = Literal["example", "additional_request"]


class ErrorBody(BaseModel):
    code: str
    message_he: str
    retryable: bool = False
    request_id: UUID | None = None
    field: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class HealthResponse(BaseModel):
    status: Literal["ok"]


class CatalogResponse(BaseModel):
    sections: list[dict[str, str]]
    providers: list[dict[str, str]]
    limits: dict[str, int]


class WorkspaceMembership(BaseModel):
    workspace_id: UUID
    role: Literal["admin", "member"]


class MeResponse(BaseModel):
    user_id: UUID
    display_name: str
    memberships: list[WorkspaceMembership]


class AttachmentReservationRequest(BaseModel):
    workspace_id: UUID
    original_name: str = Field(min_length=1, max_length=255)
    suffix: Literal[".pdf", ".docx", ".xlsx", ".xls", ".csv", ".txt", ".md"]
    size_bytes: int = Field(gt=0, le=20 * 1024 * 1024)

    @field_validator("original_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if "/" in value or "\\" in value or value != value.strip():
            raise ValueError("invalid file name")
        return value


class AttachmentReservationResponse(BaseModel):
    attachment_id: UUID
    upload_url: str
    object_path: str
    expires_at: datetime


class CreateJobRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    workspace_id: UUID
    section_id: Literal["environment_description"]
    address: str = Field(min_length=1, max_length=500)
    example: str = Field(default="", max_length=20_000)
    additional_request: str = Field(default="", max_length=20_000)
    provider_id: ProviderId
    model_id: str = Field(min_length=1, max_length=160)
    example_attachment_ids: list[UUID] = Field(default_factory=list, max_length=5)
    additional_request_attachment_ids: list[UUID] = Field(default_factory=list, max_length=5)
    consent_version: str = Field(min_length=1, max_length=80)

    @field_validator("example_attachment_ids", "additional_request_attachment_ids")
    @classmethod
    def unique_attachments(cls, values: list[UUID]) -> list[UUID]:
        if len(values) != len(set(values)):
            raise ValueError("duplicate attachment")
        return values


class CreateJobResponse(BaseModel):
    job_id: UUID
    status: Literal["queued"]
    status_url: str
    request_id: UUID
