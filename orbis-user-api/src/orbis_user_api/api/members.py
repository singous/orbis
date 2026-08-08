from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.deps import (
    get_current_user,
    get_optional_current_user,
    get_session,
)
from orbis_user_api.models.user import User
from orbis_user_api.schemas.member import (
    InvitationAcceptRequest,
    InvitationAcceptResponse,
    InvitationCreateRequest,
    InvitationListResponse,
    InvitationOut,
    MailStatusOut,
    MemberListResponse,
    MemberOut,
    MemberRoleUpdateRequest,
)
from orbis_user_api.services.authorization import AuthorizationService
from orbis_user_api.services.exceptions import (
    InvitationAccountExists,
    InvitationExpired,
    InvitationForbidden,
    InvitationInvalid,
    InvitationPasswordRequired,
    MailServiceUnavailable,
    UserWorkspaceMissing,
    WorkspaceMemberForbidden,
    WorkspaceMemberNotFound,
)
from orbis_user_api.services.invitation import (
    accept_invitation,
    create_invitation,
    list_invitations,
    resend_invitation,
    revoke_invitation,
)
from orbis_user_api.services.member import (
    list_members,
    remove_member,
    update_member_role,
)
from orbis_user_api.services.workspace import member_payload

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("/mail-status", response_model=MailStatusOut)
async def get_mail_status(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MailStatusOut:
    try:
        await AuthorizationService.actor(user, session)
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active workspace membership required",
        ) from None
    return MailStatusOut(
        available=request.app.state.mail_sender.available,
        transport=request.app.state.settings.mail_transport,
    )


@router.post(
    "/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED
)
async def invite_member(
    payload: InvitationCreateRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await create_invitation(
            payload,
            user,
            request.app.state.settings,
            request.app.state.mail_sender,
            session,
        )
    except MailServiceUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mail service is unavailable",
        ) from None
    except (InvitationForbidden, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation operation forbidden",
        ) from None
    except InvitationInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Invitation cannot be created"
        ) from None
    except UserWorkspaceMissing:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active workspace membership required",
        ) from None


@router.get("/invitations", response_model=InvitationListResponse)
async def get_invitations(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InvitationListResponse:
    try:
        return InvitationListResponse(items=await list_invitations(user, session))
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation operation forbidden",
        ) from None


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invitation(
    invitation_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await revoke_invitation(invitation_id, user, session)
    except InvitationInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Invitation cannot be revoked"
        ) from None
    except (InvitationForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation operation forbidden",
        ) from None


@router.post("/invitations/{invitation_id}/resend", response_model=InvitationOut)
async def resend_workspace_invitation(
    invitation_id: UUID,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await resend_invitation(
            invitation_id,
            user,
            request.app.state.settings,
            request.app.state.mail_sender,
            session,
        )
    except MailServiceUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mail service is unavailable",
        ) from None
    except InvitationExpired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="Invitation has expired"
        ) from None
    except InvitationInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Invitation cannot be resent"
        ) from None
    except (InvitationForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation operation forbidden",
        ) from None


@router.post(
    "/invitations/accept",
    response_model=InvitationAcceptResponse,
    status_code=status.HTTP_201_CREATED,
)
async def accept_workspace_invitation(
    payload: InvitationAcceptRequest,
    request: Request,
    user: User | None = Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        (
            accepted_user,
            membership,
            access_token,
            refresh_token,
        ) = await accept_invitation(
            payload,
            user,
            request.app.state.settings,
            session,
        )
    except InvitationExpired:
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="Invitation has expired"
        ) from None
    except InvitationAccountExists:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with the invited account before accepting",
        ) from None
    except InvitationPasswordRequired:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password and display name are required for a new account",
        ) from None
    except InvitationForbidden:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation acceptance forbidden",
        ) from None
    except InvitationInvalid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invitation is invalid or already used",
        ) from None

    return {
        "user": accepted_user,
        "membership": member_payload(membership, accepted_user),
        "access_token": access_token,
        "refresh_token": refresh_token,
    }


@router.get("/members", response_model=MemberListResponse)
async def get_members(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MemberListResponse:
    try:
        return MemberListResponse(items=await list_members(user, session))
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active workspace membership required",
        ) from None


@router.patch("/members/{member_id}", response_model=MemberOut)
async def change_member_role(
    member_id: UUID,
    payload: MemberRoleUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    try:
        return await update_member_role(member_id, payload.role, user, session)
    except WorkspaceMemberNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found"
        ) from None
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Member role operation forbidden",
        ) from None


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(
    member_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await remove_member(member_id, user, session)
    except WorkspaceMemberNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace member not found"
        ) from None
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Member removal forbidden"
        ) from None
