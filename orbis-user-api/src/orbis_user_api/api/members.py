from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbis_user_api.api.contract import (
    ApiRouter,
    PageData,
    PaginationParams,
    build_page_data,
)
from orbis_user_api.api.errors import ApiError

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
    InvitationOut,
    MailStatusOut,
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

router = ApiRouter(prefix="/workspace", tags=["workspace"])


@router.get("/mail-status", response_model=MailStatusOut)
async def get_mail_status(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MailStatusOut:
    try:
        await AuthorizationService.actor(user, session)
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
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
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="MAIL_SERVICE_UNAVAILABLE",
            message="邮件服务暂不可用",
        ) from None
    except (InvitationForbidden, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="INVITATION_OPERATION_FORBIDDEN",
            message="无权执行邀请操作",
        ) from None
    except InvitationInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="INVITATION_INVALID",
            message="当前邀请无法创建",
        ) from None
    except UserWorkspaceMissing:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
        ) from None


@router.get("/invitations", response_model=PageData[InvitationOut])
async def get_invitations(
    pagination: PaginationParams = Depends(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PageData[InvitationOut]:
    try:
        items, total = await list_invitations(
            user,
            session,
            offset=pagination.offset,
            limit=pagination.page_size,
        )
        return build_page_data(
            items,
            page=pagination.page,
            page_size=pagination.page_size,
            total=total,
        )
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="INVITATION_OPERATION_FORBIDDEN",
            message="无权执行邀请操作",
        ) from None


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_200_OK)
async def delete_invitation(
    invitation_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await revoke_invitation(invitation_id, user, session)
    except InvitationInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="INVITATION_INVALID",
            message="当前邀请无法撤销",
        ) from None
    except (InvitationForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="INVITATION_OPERATION_FORBIDDEN",
            message="无权执行邀请操作",
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
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="MAIL_SERVICE_UNAVAILABLE",
            message="邮件服务暂不可用",
        ) from None
    except InvitationExpired:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="INVITATION_EXPIRED",
            message="邀请已过期",
        ) from None
    except InvitationInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="INVITATION_INVALID",
            message="当前邀请无法重新发送",
        ) from None
    except (InvitationForbidden, UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="INVITATION_OPERATION_FORBIDDEN",
            message="无权执行邀请操作",
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
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="INVITATION_EXPIRED",
            message="邀请已过期",
        ) from None
    except InvitationAccountExists:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="INVITATION_ACCOUNT_AUTHENTICATION_REQUIRED",
            message="请先登录受邀账号再接受邀请",
        ) from None
    except InvitationPasswordRequired:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="INVITATION_ACCOUNT_PROFILE_REQUIRED",
            message="新账号必须提供密码和显示名称",
        ) from None
    except InvitationForbidden:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="INVITATION_ACCEPTANCE_FORBIDDEN",
            message="无权接受此邀请",
        ) from None
    except InvitationInvalid:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="INVITATION_INVALID",
            message="邀请无效或已经使用",
        ) from None

    return {
        "user": accepted_user,
        "membership": member_payload(membership, accepted_user),
        "access_token": access_token,
        "refresh_token": refresh_token,
    }


@router.get("/members", response_model=PageData[MemberOut])
async def get_members(
    pagination: PaginationParams = Depends(),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PageData[MemberOut]:
    try:
        items, total = await list_members(
            user,
            session,
            offset=pagination.offset,
            limit=pagination.page_size,
        )
        return build_page_data(
            items,
            page=pagination.page,
            page_size=pagination.page_size,
            total=total,
        )
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED",
            message="需要有效的工作空间成员身份",
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
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="WORKSPACE_MEMBER_NOT_FOUND",
            message="工作空间成员不存在",
        ) from None
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="MEMBER_ROLE_OPERATION_FORBIDDEN",
            message="无权修改成员角色",
        ) from None


@router.delete("/members/{member_id}", status_code=status.HTTP_200_OK)
async def delete_member(
    member_id: UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await remove_member(member_id, user, session)
    except WorkspaceMemberNotFound:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="WORKSPACE_MEMBER_NOT_FOUND",
            message="工作空间成员不存在",
        ) from None
    except (UserWorkspaceMissing, WorkspaceMemberForbidden):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="MEMBER_REMOVAL_FORBIDDEN",
            message="无权移除该成员",
        ) from None
