from __future__ import annotations

from uuid import UUID

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message_he: str, *, retryable: bool = False, field: str | None = None) -> None:
        self.status_code = status_code
        self.code = code
        self.message_he = message_he
        self.retryable = retryable
        self.field = field


async def api_error_handler(request: Request, error: ApiError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=error.status_code,
        content={
            "error": {
                "code": error.code,
                "message_he": error.message_he,
                "retryable": error.retryable,
                "request_id": str(request_id) if isinstance(request_id, UUID) else None,
                "field": error.field,
            }
        },
        headers={"Cache-Control": "no-store"},
    )
