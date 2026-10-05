"""One text-safe Markdown representation for every table export surface."""

from html import escape


def render_table_markdown(data):
    def text(value):
        value = escape(str(value), quote=False).replace("\\", "\\\\")
        for symbol in ("|", "*", "_", "[", "]", "`"):
            value = value.replace(symbol, "\\" + symbol)
        return value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")

    heading = f"### {text(data['title'])}\n\n视图：{text(data['view'])}；快照版本：{data['revision']}\n\n"
    if not data.get("columns"):
        return heading + "暂无公开字段"
    rows = [
        "| " + " | ".join(map(text, data["columns"])) + " |",
        "| " + " | ".join("---" for _ in data["columns"]) + " |",
    ]
    rows.extend("| " + " | ".join(map(text, row)) + " |" for row in data["rows"])
    return heading + "\n".join(rows)
