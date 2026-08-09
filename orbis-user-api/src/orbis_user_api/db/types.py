from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import CHAR
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.types import JSON, TypeDecorator

json_type = JSON().with_variant(JSONB, "postgresql")


class GUID(TypeDecorator[UUID]):
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect: Any) -> Any:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PostgresUUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value: UUID | str | None, dialect: Any) -> UUID | str | None:
        if value is None:
            return None
        if dialect.name == "postgresql":
            return value if isinstance(value, UUID) else UUID(str(value))
        return str(value)

    def process_result_value(self, value: UUID | str | None, dialect: Any) -> UUID | None:
        if value is None:
            return None
        return value if isinstance(value, UUID) else UUID(str(value))
