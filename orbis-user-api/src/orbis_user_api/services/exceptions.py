from __future__ import annotations


class ServiceError(Exception):
    """Base class for expected service-layer errors."""


class EmailAlreadyRegistered(ServiceError):
    pass


class InvalidCredentials(ServiceError):
    pass


class InvalidRefreshToken(ServiceError):
    pass


class UserWorkspaceMissing(ServiceError):
    pass


class NoteNotFound(ServiceError):
    pass


class NoteVersionConflict(ServiceError):
    pass
