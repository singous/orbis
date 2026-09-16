"""Preserve URL semantics inside Markdown destination delimiters."""

from urllib.parse import quote


def markdown_destination(value: str) -> str:
    return "".join(
        "\\" + char
        if char in "\\()"
        else quote(char, safe="")
        if ord(char) <= 32 or ord(char) == 127 or char in "<>"
        else char
        for char in value
    )
