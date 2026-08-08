from __future__ import annotations

from typing import Any, Protocol

from aiokafka import AIOKafkaProducer
from pydantic import BaseModel

from orbis_user_api.core.settings import Settings


class EventPublisher(Protocol):
    async def publish(self, topic: str, payload: BaseModel) -> None: ...


class InMemoryEventPublisher:
    def __init__(self) -> None:
        self.messages: list[tuple[str, BaseModel]] = []

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def publish(self, topic: str, payload: BaseModel) -> None:
        self.messages.append((topic, payload))


class KafkaEventPublisher:
    def __init__(self, bootstrap_servers: str) -> None:
        self._producer = AIOKafkaProducer(
            bootstrap_servers=bootstrap_servers,
            value_serializer=lambda value: value.model_dump_json().encode("utf-8"),
        )

    async def start(self) -> None:
        await self._producer.start()

    async def stop(self) -> None:
        await self._producer.stop()

    async def publish(self, topic: str, payload: BaseModel) -> None:
        await self._producer.send_and_wait(topic, payload)


def create_event_publisher(settings: Settings) -> Any:
    if settings.event_transport == "kafka":
        return KafkaEventPublisher(settings.kafka_bootstrap_servers)
    return InMemoryEventPublisher()
