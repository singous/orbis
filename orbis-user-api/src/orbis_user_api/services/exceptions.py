from __future__ import annotations


class ServiceError(Exception):
    """Base class for expected service-layer errors."""


class SystemAlreadyInitialized(ServiceError):
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


class WorkspaceMemberForbidden(ServiceError):
    pass


class MailServiceUnavailable(ServiceError):
    pass


class InvitationForbidden(ServiceError):
    pass


class InvitationInvalid(ServiceError):
    pass


class InvitationExpired(ServiceError):
    pass


class InvitationAccountExists(ServiceError):
    pass


class InvitationPasswordRequired(ServiceError):
    pass


class OwnershipTransferForbidden(ServiceError):
    pass


class OwnershipTransferInvalid(ServiceError):
    pass


class OwnershipTransferExpired(ServiceError):
    pass


class OwnershipTransferAlreadyPending(ServiceError):
    pass


class OwnershipTransferNotFound(ServiceError):
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
