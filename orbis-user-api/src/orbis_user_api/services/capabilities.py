from __future__ import annotations

from enum import StrEnum


class Capability(StrEnum):
    RESOURCE_READ = "resource.read"
    RESOURCE_MANAGE = "resource.manage"
    MEMBER_READ = "member.read"
    MEMBER_MANAGE = "member.manage"
    OWNERSHIP_TRANSFER = "ownership.transfer"
    KNOWLEDGE_BASE_DELETE = "knowledge_base.delete"


ROLE_CAPABILITIES: dict[str, frozenset[Capability]] = {
    "owner": frozenset(Capability),
    "admin": frozenset(
        {
            Capability.RESOURCE_READ,
            Capability.RESOURCE_MANAGE,
            Capability.MEMBER_READ,
            Capability.MEMBER_MANAGE,
            Capability.KNOWLEDGE_BASE_DELETE,
        }
    ),
    "editor": frozenset(
        {Capability.RESOURCE_READ, Capability.RESOURCE_MANAGE, Capability.MEMBER_READ}
    ),
    "normal": frozenset({Capability.RESOURCE_READ, Capability.MEMBER_READ}),
}


READABLE_WORKSPACE_ROLES = tuple(
    role
    for role, capabilities in ROLE_CAPABILITIES.items()
    if Capability.RESOURCE_READ in capabilities
)
