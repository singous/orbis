"""Bounded immutable-body cache; public authorization is never cached."""

import json
from collections import OrderedDict
from threading import RLock
from typing import Any

MAX_CACHE_BYTES = 32 * 1024 * 1024
MAX_CACHE_ENTRIES = 256
MAX_PAGE_CACHE_BYTES = 2 * 1024 * 1024


class ImmutablePageCache:
    def __init__(
        self,
        max_bytes: int = MAX_CACHE_BYTES,
        max_entries: int = MAX_CACHE_ENTRIES,
        max_page_bytes: int = MAX_PAGE_CACHE_BYTES,
    ):
        self.max_bytes, self.max_entries, self.max_page_bytes = (
            max_bytes,
            max_entries,
            max_page_bytes,
        )
        self._values: OrderedDict[tuple, bytes] = OrderedDict()
        self._bytes = 0
        self._lock = RLock()

    def get(self, key: tuple) -> dict[str, Any] | None:
        with self._lock:
            value = self._values.get(key)
            if value is None:
                return None
            self._values.move_to_end(key)
        return json.loads(value)

    def put(self, key: tuple, value: dict[str, Any]) -> None:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        if len(encoded) > min(self.max_page_bytes, self.max_bytes):
            return
        with self._lock:
            previous = self._values.pop(key, None)
            self._bytes -= len(previous) if previous else 0
            self._values[key] = encoded
            self._bytes += len(encoded)
            while self._bytes > self.max_bytes or len(self._values) > self.max_entries:
                _, discarded = self._values.popitem(last=False)
                self._bytes -= len(discarded)

    def clear(self) -> None:
        with self._lock:
            self._values.clear()
            self._bytes = 0

    @property
    def byte_size(self) -> int:
        with self._lock:
            return self._bytes


page_cache = ImmutablePageCache()
