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


class DefaultDocumentGroupArchiveForbidden(ServiceError):
    pass


class DefaultDocumentGroupMissing(ServiceError):
    pass


class NotebookNotFound(ServiceError):
    pass


class NoteNotFound(ServiceError):
    pass


class NoteVersionConflict(ServiceError):
    pass


class NoteContentInvalid(ServiceError):
    pass


class NoteParentInvalid(ServiceError):
    pass


class KnowledgeBaseNotFound(ServiceError):
    pass


class KnowledgeBaseConfirmationInvalid(ServiceError):
    pass


class KnowledgeCleanupFailed(ServiceError):
    pass


class SourceNotFound(ServiceError):
    pass


class SourceTypeUnsupported(ServiceError):
    pass


class DuplicateKnowledgeSource(ServiceError):
    def __init__(
        self,
        *,
        source_id: object,
        filename: str,
        processing_status: str,
    ) -> None:
        self.source_id = source_id
        self.filename = filename
        self.processing_status = processing_status


class EventPublishFailed(ServiceError):
    def __init__(self, details: dict[str, str]) -> None:
        self.details = details


class ProcessingJobNotFound(ServiceError):
    pass


class ProcessingJobRetryInvalid(ServiceError):
    pass
