from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ORBIS_", extra="ignore")

    database_url: str = Field(min_length=1)
    database_schema: str | None = None
    storage_dir: Path = Path("./storage/files")
    auto_create_tables: bool = False

    access_token_secret: str = Field(default="change-me-access-secret", min_length=16)
    refresh_token_secret: str = Field(default="change-me-refresh-secret", min_length=16)
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_seconds: int = 30 * 24 * 60 * 60

    email_code_ttl_seconds: int = 10 * 60
    email_code_resend_seconds: int = 60

    bootstrap_superuser_enabled: bool = True
    bootstrap_superuser_email: str = "admin@orbis.com"
    bootstrap_superuser_password: str = "orbis_admin"
