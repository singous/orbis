"""Versioned drawing scenes and their reader-visible preview contract."""

import json
import math
import re
from typing import Any

DRAWING_VERSION = 1
MAX_DRAWING_BYTES = 1024 * 1024
MAX_DRAWING_ELEMENTS = 2000
MAX_COORDINATE = 1_000_000
MAX_DRAWING_POINTS = 20_000
DRAWING_ELEMENT_TYPES = frozenset(
    {"rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "text"}
)


def _coordinate(value: Any) -> bool:
    return type(value) in (int, float) and abs(value) <= MAX_COORDINATE and math.isfinite(value)


def _validate_element_data(element: dict) -> None:
    points = element.get("points")
    if element["type"] in {"line", "arrow", "freedraw"} and not isinstance(points, list):
        raise ValueError("Drawing line points are invalid")
    if "points" in element and (
        not isinstance(points, list) or not points or len(points) > MAX_DRAWING_POINTS
        or any(not isinstance(point, list) or len(point) != 2 or not all(_coordinate(value) for value in point) for point in points)
    ):
        raise ValueError("Drawing line points are invalid")
    if element["type"] == "text" and not isinstance(element.get("text"), str):
        raise ValueError("Drawing text is invalid")
    for field in ("strokeColor", "backgroundColor", "text", "originalText"):
        if field in element and not isinstance(element[field], str):
            raise ValueError("Drawing element property is invalid")
    groups = element.get("groupIds", [])
    if not isinstance(groups, list) or any(not isinstance(key, str) for key in groups):
        raise ValueError("Drawing groups are invalid")
    bound = element.get("boundElements")
    if bound is not None and (
        not isinstance(bound, list)
        or any(not isinstance(item, dict) or not isinstance(item.get("id"), str) or item.get("type") not in ("arrow", "text") for item in bound)
    ):
        raise ValueError("Drawing element bindings are invalid")
    for field in ("startBinding", "endBinding"):
        binding = element.get(field)
        if binding is not None and (not isinstance(binding, dict) or not isinstance(binding.get("elementId"), str) or not _coordinate(binding.get("focus")) or not _coordinate(binding.get("gap"))):
            raise ValueError("Drawing arrow binding is invalid")


def read_drawing_scene(source: Any) -> dict:
    if source == "":
        return {"version": DRAWING_VERSION, "elements": [], "appState": {"viewBackgroundColor": "#ffffff"}}
    if not isinstance(source, str) or len(source.encode("utf-8")) > MAX_DRAWING_BYTES:
        raise ValueError("Drawing scene exceeds the size limit")
    try:
        scene = json.loads(source)
    except (ValueError, RecursionError) as error:
        raise ValueError("Drawing scene is invalid JSON") from error
    if not isinstance(scene, dict) or type(scene.get("version")) is not int or scene["version"] != DRAWING_VERSION:
        raise ValueError("Drawing scene version is unsupported")
    elements = scene.get("elements")
    if not isinstance(elements, list) or len(elements) > MAX_DRAWING_ELEMENTS:
        raise ValueError("Drawing scene element limit exceeded")
    ids = set()
    for element in elements:
        if not isinstance(element, dict) or not isinstance(element.get("type"), str) or element["type"] not in DRAWING_ELEMENT_TYPES:
            raise ValueError("Drawing element type is unsupported")
        identifier = element.get("id")
        if not isinstance(identifier, str) or not identifier or len(identifier) > 200 or identifier in ids:
            raise ValueError("Drawing element identity is invalid")
        ids.add(identifier)
        for field in ("x", "y", "width", "height"):
            number = element.get(field)
            if not _coordinate(number):
                raise ValueError("Drawing element geometry is invalid")
        if element["width"] < 0 or element["height"] < 0 or any(element.get(key) for key in ("isDeleted", "customData", "link")):
            raise ValueError("Drawing element contains unsupported data")
        _validate_element_data(element)
    state = scene.get("appState")
    if not isinstance(state, dict) or not isinstance(state.get("viewBackgroundColor"), str) or not re.fullmatch(r"(?:#[\da-fA-F]{3,8}|transparent)", state["viewBackgroundColor"]):
        raise ValueError("Drawing background is invalid")
    return scene


def validate_drawing(block: dict) -> None:
    if block.get("children") or block.get("content"):
        raise ValueError("Drawing blocks cannot contain child or inline content")
    props = block.get("props", {})
    scene = read_drawing_scene(props.get("scene", ""))
    if not isinstance(props.get("caption", ""), str) or len(props.get("caption", "")) > 200:
        raise ValueError("Drawing caption is invalid")
    url = props.get("url", "")
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError("Drawing preview reference is invalid")
    if scene["elements"] and not url:
        raise ValueError("A saved drawing requires a preview")


def drawing_text(source: Any) -> str:
    return "\n".join(
        element["text"] for element in read_drawing_scene(source)["elements"]
        if element["type"] == "text" and isinstance(element.get("text"), str)
    )
