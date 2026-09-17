from __future__ import annotations

from typing import Annotated, Literal, TypeAlias
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

NotebookIconName: TypeAlias = Literal[
    "book",
    "notebook",
    "folder",
    "file-text",
    "lightbulb",
    "code",
    "palette",
    "rocket",
    "flask",
    "globe",
    "graduation-cap",
    "heart",
    "briefcase",
    "target",
    "coffee",
    "music",
]
NotebookIconColor: TypeAlias = Literal[
    "blue",
    "mint",
    "violet",
    "amber",
    "rose",
    "cyan",
    "slate",
]


class PresetNotebookIcon(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["preset"] = Field(description="预设图标类型，固定为 preset。")
    name: NotebookIconName = Field(description="内置图标名称。")
    color: NotebookIconColor = Field(description="内置图标配色名称。")


class ImageNotebookIcon(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["image"] = Field(description="自定义图片图标类型，固定为 image。")
    file_id: UUID = Field(
        description="当前工作空间通过笔记本图标接口上传的文件 UUIDv7；不接受普通附件标识。"
    )


NotebookIcon: TypeAlias = Annotated[
    PresetNotebookIcon | ImageNotebookIcon, Field(discriminator="type")
]


class NotebookIconImageOut(BaseModel):
    data_url: str = Field(
        description="归一化后的 WebP 图片 data URL；通过鉴权接口读取，不包含访问令牌。"
    )


class NotebookIconUploadOut(NotebookIconImageOut):
    file_id: UUID = Field(
        description="已上传的笔记本图标文件 UUIDv7，可用于创建或修改笔记本的 icon.file_id。"
    )
