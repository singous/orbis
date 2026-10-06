"""Report semantic losses at the JSON-to-Markdown exchange boundary."""

from uuid import UUID

from orbis_user_api.domain.document_components import DOCUMENT_BLOCKS
from orbis_user_api.domain.legacy_note_blocks import editable_note_blocks
from orbis_user_api.domain.markdown_inline import STYLE_ORDER

MARKDOWN_BLOCK_PROPERTIES = {
    "heading": {"level"},
    "numberedListItem": {"start"},
    "checkListItem": {"checked"},
    "codeBlock": {"language"},
}
DEFAULT_STYLE_PROPERTIES = {
    "textColor": "default",
    "backgroundColor": "default",
    "textAlignment": "left",
}
STRUCTURAL_COMPONENTS = {
    "drawing",
    "image",
    "file",
    "audio",
    "video",
    "table",
    "toggleListItem",
} | set(DOCUMENT_BLOCKS)


def markdown_losses(note_id: UUID, content: dict) -> list[dict]:
    losses = []

    def inline_losses(value, fields):
        if isinstance(value, list):
            for item in value:
                inline_losses(item, fields)
        elif isinstance(value, dict):
            for key, enabled in value.get("styles", {}).items():
                if enabled and key not in {*STYLE_ORDER, "code"}:
                    fields.add("styles." + key)
            inline_losses(value.get("content"), fields)

    def visit(items):
        for block in items:
            fields = set()
            if block["type"] in STRUCTURAL_COMPONENTS:
                fields.update({"component_type", "component_properties"})
            else:
                allowed = MARKDOWN_BLOCK_PROPERTIES.get(block["type"], set())
                for key, value in block.get("props", {}).items():
                    if key not in allowed and not (
                        key in DEFAULT_STYLE_PROPERTIES
                        and value == DEFAULT_STYLE_PROPERTIES[key]
                    ):
                        fields.add("props." + key)
            inline_losses(block.get("content"), fields)
            if fields:
                losses.append(
                    {
                        "block_id": block["id"],
                        "type": block["type"],
                        "reason": "Markdown does not preserve these component or style fields",
                        "fields": sorted(fields),
                    }
                )
            visit(block.get("children", []))

    visit(editable_note_blocks(note_id, content)["blocks"])
    return losses
