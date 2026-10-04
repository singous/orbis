from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.types import Text


class ContentText(FunctionElement):
    """Read the current text projection, never the archived pre-migration body.

    Search deliberately walks text rows in document order; editing does not
    recompute or rewrite a full-document search string on every keystroke.
    """

    type = Text()
    inherit_cache = True


def _compile(element, compiler, *, postgres, **kw):
    note_id, legacy = [compiler.process(arg, **kw) for arg in element.clauses]
    position = (
        "lpad(CAST(b.position AS text), 20, '0')"
        if postgres
        else "printf('%020d', b.position)"
    )
    aggregate = (
        "string_agg(plain_text, chr(10) ORDER BY path)"
        if postgres
        else "group_concat(plain_text, char(10))"
    )
    return f"""CASE WHEN EXISTS (SELECT 1 FROM note_block_documents h WHERE h.note_id={note_id})
    THEN COALESCE((WITH RECURSIVE block_text_walk(block_id,path,plain_text) AS (
        SELECT b.block_id,{position},b.plain_text FROM note_block_versions b
        WHERE b.note_id={note_id} AND b.valid_to IS NULL AND b.parent_id IS NULL
        UNION ALL SELECT b.block_id,w.path || '.' || {position},b.plain_text
        FROM note_block_versions b JOIN block_text_walk w ON b.parent_id=w.block_id
        WHERE b.note_id={note_id} AND b.valid_to IS NULL)
        SELECT {aggregate} FROM (SELECT plain_text,path FROM block_text_walk WHERE plain_text<>'' ORDER BY path) ordered_text), '')
    ELSE {legacy} END"""


@compiles(ContentText, "sqlite")
def sqlite_content_text(element, compiler, **kw):
    return _compile(element, compiler, postgres=False, **kw)


@compiles(ContentText, "postgresql")
def postgres_content_text(element, compiler, **kw):
    return _compile(element, compiler, postgres=True, **kw)
