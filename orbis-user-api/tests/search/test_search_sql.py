from sqlalchemy import func, select, union_all
from sqlalchemy.dialects import postgresql

from orbis_user_api.application.search.service import PROVIDERS
from orbis_user_api.core.ids import new_uuidv7


def test_search_projections_compile_for_postgresql_with_typed_uuid_union():
    projections = [
        provider("100%_query", [new_uuidv7()], "active")
        for provider in PROVIDERS.values()
    ]
    matches = union_all(*projections).subquery("matches")
    dialect = postgresql.dialect()
    page = select(matches).order_by(matches.c.rank, matches.c.id).offset(20).limit(20)
    compiled = str(page.compile(dialect=dialect))
    count = str(select(func.count()).select_from(matches).compile(dialect=dialect))
    assert "WITH RECURSIVE search_active_notes" in compiled
    assert "::UUID" in compiled and "ESCAPE '/'" in compiled
    assert "UNION ALL" in count
    assert "LIMIT" in compiled and "OFFSET" in compiled
