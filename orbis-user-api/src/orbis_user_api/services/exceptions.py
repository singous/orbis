from __future__ import annotations


class ServiceError(Exception):
    """Base class for expected service-layer errors."""


class SystemAlreadyInitialized(ServiceError):
    pass


class EmailAlreadyRegistered(ServiceError):
    pass


class InvalidEmailCode(ServiceError):
    pass


class InvalidCredentials(ServiceError):
    pass


class InvalidRefreshToken(ServiceError):
    pass


class UserWorkspaceMissing(ServiceError):
    pass


class WorkspaceNotFound(ServiceError):
    pass


class WorkspaceMemberNotFound(ServiceError):
    pass


class WorkspaceMemberAlreadyExists(ServiceError):
    pass


class WorkspaceMemberForbidden(ServiceError):
    pass


class WorkspaceOwnerRemovalForbidden(ServiceError):
    pass


class DocumentGroupNotFound(ServiceError):
    pass


class DefaultDocumentGroupMissing(ServiceError):
    pass


class NotebookNotFound(ServiceError):
    pass


class NoteNotFound(ServiceError):
    pass


class NoteVersionConflict(ServiceError):
    pass
