from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Permission = Literal[
    "notes:read", "notes:write", "files:read", "files:write", "shares:manage"
]
MAX_OPERATIONS = 100
MAX_REQUEST_BYTES = 1024 * 1024


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    permissions: list[Permission] = Field(
        default_factory=lambda: ["notes:read"], min_length=1, max_length=5
    )
    notebook_id: UUID | None = None
    note_id: UUID | None = None
    expires_in_days: int = Field(default=90, ge=1, le=365)

    @field_validator("name")
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name must not be blank")
        return value.strip()


class OperationBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UpdateBlock(OperationBase):
    type: Literal["update_block"]
    block_id: str = Field(min_length=1, max_length=512)
    expected_block_revision: int | None = Field(default=None, ge=1)
    block: dict[str, Any]


class ReplaceText(OperationBase):
    type: Literal["replace_text"]
    block_id: str = Field(min_length=1, max_length=512)
    expected_block_revision: int | None = Field(default=None, ge=1)
    match: str = Field(min_length=1, max_length=131072)
    replacement: str = Field(max_length=131072)


class InsertBlocks(OperationBase):
    type: Literal["insert_blocks"]
    parent_id: str | None = Field(default=None, max_length=512)
    after_id: str | None = Field(default=None, max_length=512)
    blocks: list[dict[str, Any]] = Field(min_length=1, max_length=100)


class MoveBlock(OperationBase):
    type: Literal["move_block"]
    block_id: str = Field(min_length=1, max_length=512)
    parent_id: str | None = Field(default=None, max_length=512)
    after_id: str | None = Field(default=None, max_length=512)


class DeleteBlock(OperationBase):
    type: Literal["delete_block"]
    block_id: str = Field(min_length=1, max_length=512)
    delete_subtree: bool = False


class UpdateMetadata(OperationBase):
    type: Literal["update_metadata"]
    expected_updated_at_ms: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=240)

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Title must not be blank")
        return value.strip()


Operation = Annotated[
    UpdateBlock | ReplaceText | InsertBlocks | MoveBlock | DeleteBlock | UpdateMetadata,
    Field(discriminator="type"),
]


class OperationsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    expected_version: int = Field(ge=1)
    operations: list[Operation] = Field(min_length=1, max_length=MAX_OPERATIONS)

    @model_validator(mode="after")
    def bounded_payload(self):
        if len(self.model_dump_json().encode()) > MAX_REQUEST_BYTES:
            raise ValueError("Operation request exceeds one MiB")
        return self


class LibraryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    notebook_id: UUID
    parent_id: UUID | None = None
    title: str = Field(min_length=1, max_length=240)
    markdown: str = Field(default="", max_length=512 * 1024)

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Title must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def bounded_payload(self):
        if len(self.model_dump_json().encode()) > MAX_REQUEST_BYTES:
            raise ValueError("Create request exceeds one MiB")
        return self


class ResolveRequest(BaseModel):
    note_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=240)

    @model_validator(mode="after")
    def one_target(self):
        if (self.note_id is None) == (self.title is None):
            raise ValueError("Choose note_id or title")
        return self


class ImportBegin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    notebook_id: UUID
    parent_id: UUID | None = None
    title: str = Field(min_length=1, max_length=240)
    total_bytes: int = Field(gt=0)
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Title must not be blank")
        return value.strip()
