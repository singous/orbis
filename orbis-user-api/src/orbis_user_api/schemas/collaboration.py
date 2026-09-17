from __future__ import annotations

from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_COMMENT_LENGTH = 10_000


class CommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LENGTH)
    parent_id: UUID | None = None

    @field_validator("body")
    @classmethod
    def validate_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Comment body cannot be blank")
        return value


class CommentUpdateRequest(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=MAX_COMMENT_LENGTH)
    is_resolved: bool | None = None

    @model_validator(mode="after")
    def validate_update(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one comment field is required")
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError("Comment fields cannot be null")
        if self.body is not None:
            self.body = CommentCreateRequest.validate_body(self.body)
        return self


class CommentOut(BaseModel):
    id: UUID
    note_id: UUID
    parent_id: UUID | None
    author_id: UUID
    author_name: str
    body: str
    is_resolved: bool
    created_at_ms: int
    updated_at_ms: int


class RevisionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    content_version: int
    author_name: str
    created_at_ms: int


class RevisionOut(RevisionSummary):
    blocks: dict[str, Any]
    plain_text: str


class RevisionRestoreRequest(BaseModel):
    expected_version: int = Field(ge=1)
