from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from orbis_user_api.core.settings import Settings
from orbis_user_api.core.time import now_ms

JWT_ALGORITHM = "HS256"

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_access_token(user_id: UUID, settings: Settings) -> str:
    expires_at = datetime.now(UTC) + timedelta(
        seconds=settings.access_token_ttl_seconds
    )
    return jwt.encode(
        {"sub": str(user_id), "type": "access", "exp": expires_at},
        settings.access_token_secret,
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(token: str, settings: Settings) -> UUID:
    payload = jwt.decode(
        token, settings.access_token_secret, algorithms=[JWT_ALGORITHM]
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")
    return UUID(payload["sub"])


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str, settings: Settings) -> str:
    return hashlib.sha256(
        f"{settings.refresh_token_secret}:{token}".encode()
    ).hexdigest()


def refresh_token_expires_at_ms(settings: Settings) -> int:
    return now_ms() + settings.refresh_token_ttl_seconds * 1000


def new_action_token() -> str:
    return secrets.token_urlsafe(48)


def hash_action_token(token: str, settings: Settings) -> str:
    return hmac.new(
        settings.action_token_secret.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
