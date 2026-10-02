from uuid import UUID

from sqlalchemy import case, false, literal, or_, select
from sqlalchemy.sql import Select

from orbis_user_api.models.file import FileAsset
from orbis_user_api.models.site import Site
from orbis_user_api.schemas.search import SearchStatus

from .projection import literal_match, projection, title_rank


def sites(query: str, workspace_ids: list[UUID], status: SearchStatus) -> Select:
    title_match = literal_match(Site.name, query)
    metadata = Site.description + literal(" ") + Site.slug
    return select(
        *projection(
            kind="site",
            model=Site,
            title=Site.name,
            location=literal("站点 / ") + Site.slug,
            snippet=case((title_match, Site.name), else_=metadata),
            match=case((title_match, "title"), else_="metadata"),
            rank=title_rank(Site.name, query),
            status=literal("active"),
        )
    ).where(
        Site.workspace_id.in_(workspace_ids),
        false()
        if status == "archived"
        else or_(title_match, literal_match(metadata, query)),
    )


def files(query: str, workspace_ids: list[UUID], status: SearchStatus) -> Select:
    title_match = literal_match(FileAsset.original_filename, query)
    return select(
        *projection(
            kind="file",
            model=FileAsset,
            title=FileAsset.original_filename,
            location=literal("文件与附件"),
            snippet=case(
                (title_match, FileAsset.original_filename), else_=FileAsset.mime_type
            ),
            match=case((title_match, "title"), else_="metadata"),
            rank=title_rank(FileAsset.original_filename, query),
            status=literal("active"),
            updated=FileAsset.created_at_ms,
        )
    ).where(
        FileAsset.workspace_id.in_(workspace_ids),
        FileAsset.upload_status == "completed",
        false()
        if status == "archived"
        else or_(title_match, literal_match(FileAsset.mime_type, query)),
    )
