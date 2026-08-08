from __future__ import annotations

import hashlib
import json
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.core.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    refresh_token_expires_at_ms,
    verify_password,
)
from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms
from orbis_user_api.models.user import EmailVerificationCode, RefreshSession, User
from orbis_user_api.schemas.auth import EmailCodeRequest, LoginRequest, LogoutRequest, RefreshRequest, RegisterRequest
from orbis_user_api.services.document_group import ensure_default_document_group
from orbis_user_api.services.exceptions import (
    EmailAlreadyRegistered,
    InvalidCredentials,
    InvalidEmailCode,
    InvalidRefreshToken,
)
from orbis_user_api.services.workspace import ensure_default_workspace


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_email_code(email: str, purpose: str, code: str, settings: Settings) -> str:
    payload = f"{settings.access_token_secret}:{email}:{purpose}:{code}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def new_email_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def write_dev_email_outbox(settings: Settings, email: str, purpose: str, code: str, expires_at_ms: int) -> None:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    outbox_path = settings.storage_dir / "email_outbox.jsonl"
    message = {
        "email": email,
        "purpose": purpose,
        "code": code,
        "expires_at_ms": expires_at_ms,
        "created_at_ms": now_ms(),
    }
    with outbox_path.open("a", encoding="utf-8") as outbox:
        outbox.write(json.dumps(message, ensure_ascii=False) + "\n")


async def send_email_code(
    payload: EmailCodeRequest,
    settings: Settings,
    session: AsyncSession,
) -> tuple[int, int]:
    email = normalize_email(str(payload.email))
    purpose = payload.purpose
    timestamp = now_ms()
    expires_at_ms = timestamp + settings.email_code_ttl_seconds * 1000
    resend_after_ms = timestamp + settings.email_code_resend_seconds * 1000
    code = new_email_code()
    session.add(
        EmailVerificationCode(
            email=email,
            purpose=purpose,
            code_hash=hash_email_code(email, purpose, code, settings),
            expires_at_ms=expires_at_ms,
            created_at_ms=timestamp,
        )
    )
    await session.commit()
    write_dev_email_outbox(settings, email, purpose, code, expires_at_ms)
    return expires_at_ms, resend_after_ms


async def consume_email_code(
    email: str,
    purpose: str,
    code: str,
    settings: Settings,
    session: AsyncSession,
) -> None:
    timestamp = now_ms()
    result = await session.execute(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.consumed_at_ms.is_(None),
            EmailVerificationCode.expires_at_ms > timestamp,
        )
        .order_by(EmailVerificationCode.created_at_ms.desc())
    )
    verification = result.scalars().first()
    if verification is None or verification.code_hash != hash_email_code(email, purpose, code, settings):
        raise InvalidEmailCode
    verification.consumed_at_ms = timestamp


async def create_refresh_session(user: User, settings: Settings, session: AsyncSession) -> str:
    token = new_refresh_token()
    refresh_session = RefreshSession(
        user_id=user.id,
        token_hash=hash_refresh_token(token, settings),
        expires_at_ms=refresh_token_expires_at_ms(settings),
    )
    session.add(refresh_session)
    return token


async def register_user(
    payload: RegisterRequest,
    settings: Settings,
    session: AsyncSession,
) -> tuple[str, str, User]:
    email = normalize_email(str(payload.email))
    existing = await session.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        raise EmailAlreadyRegistered

    await consume_email_code(email, "register", payload.code, settings, session)

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    session.add(user)
    await session.flush()

    workspace = await ensure_default_workspace(session, user)
    await ensure_default_document_group(session, workspace, user)

    refresh_token = await create_refresh_session(user, settings, session)
    await session.commit()
    await session.refresh(user)
    return create_access_token(user.id, settings), refresh_token, user


async def login_user(payload: LoginRequest, settings: Settings, session: AsyncSession) -> tuple[str, str, User]:
    result = await session.execute(select(User).where(User.email == normalize_email(str(payload.email))))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise InvalidCredentials

    refresh_token = await create_refresh_session(user, settings, session)
    await session.commit()
    return create_access_token(user.id, settings), refresh_token, user


async def refresh_access_token(payload: RefreshRequest, settings: Settings, session: AsyncSession) -> str:
    token_hash = hash_refresh_token(payload.refresh_token, settings)
    result = await session.execute(select(RefreshSession).where(RefreshSession.token_hash == token_hash))
    refresh_session = result.scalar_one_or_none()
    if (
        refresh_session is None
        or refresh_session.revoked_at_ms is not None
        or refresh_session.expires_at_ms <= now_ms()
    ):
        raise InvalidRefreshToken

    user = await session.get(User, refresh_session.user_id)
    if user is None or user.status != "active":
        raise InvalidRefreshToken
    return create_access_token(user.id, settings)


async def logout_refresh_session(payload: LogoutRequest, settings: Settings, session: AsyncSession) -> None:
    token_hash = hash_refresh_token(payload.refresh_token, settings)
    result = await session.execute(select(RefreshSession).where(RefreshSession.token_hash == token_hash))
    refresh_session = result.scalar_one_or_none()
    if refresh_session is not None and refresh_session.revoked_at_ms is None:
        refresh_session.revoked_at_ms = now_ms()
        await session.commit()
