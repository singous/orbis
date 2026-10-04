"""Redact bearer share URLs before application and access logging."""
from __future__ import annotations

import logging
import re

_SECRET_PATH = re.compile(r"(/(?:public/shares|share)/)[^/?\s]+")


def safe_request_path(path: str) -> str:
    return _SECRET_PATH.sub(r"\1[redacted]", path)


class ShareAccessLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Uvicorn passes client, method, full path, protocol, and status.
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            values = list(record.args)
            if isinstance(values[2], str):
                values[2] = safe_request_path(values[2])
            record.args = tuple(values)
        return True


def install_access_log_redaction() -> None:
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, ShareAccessLogFilter) for item in access_logger.filters):
        access_logger.addFilter(ShareAccessLogFilter())
