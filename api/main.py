from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.auth import AuthenticatedUser, require_user
from api.config import Settings, get_settings
from api.contracts import CatalogResponse, HealthResponse
from api.errors import ApiError, api_error_handler


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Fail early in deployment if required configuration is missing or unsafe.
    get_settings()
    yield


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or get_settings()
    app = FastAPI(title="Real Estate Appraisal API", version="1.0.0", lifespan=lifespan)
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "If-Match"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = uuid4()
        response = await call_next(request)
        response.headers["X-Request-ID"] = str(request.state.request_id)
        if request.url.path.startswith("/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health/live", response_model=HealthResponse, include_in_schema=False)
    async def live() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get("/v1/catalog", response_model=CatalogResponse)
    async def catalog(_: AuthenticatedUser = Depends(require_user)) -> CatalogResponse:
        return CatalogResponse(
            sections=[{"id": "environment_description", "label_he": "תיאור סביבת הנכס"}],
            providers=[
                {"id": provider, "label": label}
                for provider, label in (
                    ("openai", "ChatGPT (OpenAI)"),
                    ("gemini", "Gemini"),
                    ("anthropic", "Claude (Anthropic)"),
                    ("moonshot", "Kimi (Moonshot)"),
                    ("qwen", "Qwen (DashScope)"),
                )
            ],
            limits={
                "max_attachment_bytes": active_settings.max_attachment_bytes,
                "max_job_bytes": active_settings.max_job_bytes,
                "max_attachments_per_job": 5,
                "max_text_characters": 20_000,
            },
        )

    @app.get("/v1/me")
    async def me(user: AuthenticatedUser = Depends(require_user)) -> JSONResponse:
        # Membership lookup is implemented with the repository added in the next slice.
        return JSONResponse({"user_id": str(user.id), "email": user.email, "memberships": []}, headers={"Cache-Control": "no-store"})

    return app


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=True)
