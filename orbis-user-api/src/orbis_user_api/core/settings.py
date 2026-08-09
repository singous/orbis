from __future__ import annotations

from pathlib import Path
from typing import Literal

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
    action_token_secret: str = Field(default="change-me-action-secret", min_length=16)
    access_token_ttl_seconds: int = 2 * 60 * 60
    refresh_token_ttl_seconds: int = 30 * 24 * 60 * 60

    mail_transport: Literal["disabled", "outbox", "smtp"] = "disabled"
    mail_outbox_dir: Path = Path("./storage/mail-outbox")
    mail_sender: str = "Orbis <no-reply@localhost>"
    user_web_base_url: str = "http://127.0.0.1:9200"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_security: Literal["none", "starttls", "ssl"] = "starttls"
    invitation_default_ttl_seconds: int = 24 * 60 * 60
    invitation_max_ttl_seconds: int = 7 * 24 * 60 * 60
    ownership_transfer_ttl_seconds: int = 15 * 60
