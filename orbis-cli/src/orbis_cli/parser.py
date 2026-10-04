from __future__ import annotations

import argparse

from . import __version__
from .errors import CliError


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise CliError("CLI_ARGUMENT_INVALID", message)


def common(parser, *, leaf=False):
    default = argparse.SUPPRESS if leaf else None
    parser.add_argument(
        "--json",
        action="store_true",
        default=argparse.SUPPRESS if leaf else False,
        help="Emit one stable JSON envelope to stdout",
    )
    parser.add_argument(
        "--base-url",
        default=default,
        help="Orbis instance API base URL (may end in /api)",
    )
    parser.add_argument("--workspace", default=default, help="Explicit workspace UUID")
    parser.add_argument("--profile", default=default, help="Named instance profile")
    parser.add_argument(
        "--allow-http",
        action="store_true",
        default=argparse.SUPPRESS if leaf else False,
        help="Allow HTTP for a trusted development instance",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=argparse.SUPPRESS if leaf else 15,
        help="HTTP timeout in seconds (default: 15)",
    )


def pagination(parser):
    parser.add_argument(
        "--limit",
        type=int,
        default=32,
        choices=range(1, 65),
        metavar="1..64",
        help="Bounded page size",
    )
    parser.add_argument(
        "--cursor", type=int, default=0, help="Continue from next_cursor"
    )


def build_parser():
    parser = Parser(
        prog="orbis",
        description="Use a remote Orbis instance as an online document library.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    common(parser)
    top = parser.add_subparsers(dest="family", required=True)

    def leaf(group, name, help):
        result = group.add_parser(name, help=help, description=help)
        common(result, leaf=True)
        return result

    leaf(top, "doctor", "Verify configuration, identity, permissions and reachability")
    leaf(top, "capabilities", "Read server protocol and supported operations")
    leaf(top, "schema", "Read exact operation and create JSON schemas")
    config = top.add_parser(
        "config", help="Manage non-secret instance profiles"
    ).add_subparsers(dest="command", required=True)
    leaf(config, "set", "Store base URL, workspace and development HTTP opt-in")
    leaf(config, "get", "Inspect selected profile without credentials")
    auth = top.add_parser(
        "auth", help="Store credentials in the OS keyring"
    ).add_subparsers(dest="command", required=True)
    login = leaf(
        auth, "login", "Verify a token from stdin and store it in the OS keyring"
    )
    login.add_argument(
        "--token-stdin",
        action="store_true",
        required=True,
        help="Read token without exposing it in process arguments",
    )
    leaf(auth, "status", "Verify active token identity")
    leaf(auth, "logout", "Remove this profile's saved token (does not revoke it)")
    for name in ("workspaces", "notebooks"):
        group = top.add_parser(name, help="Discover authorized " + name).add_subparsers(
            dest="command", required=True
        )
        page = leaf(group, "list", "List authorized " + name)
        if name != "workspaces":
            pagination(page)
    notes = top.add_parser(
        "notes", help="Resolve, search, read, create, import and export documents"
    ).add_subparsers(dest="command", required=True)
    page = leaf(notes, "list", "List authorized documents without loading bodies")
    pagination(page)
    page.add_argument("--notebook")
    search = leaf(notes, "search", "Search document titles and current text")
    search.add_argument("query")
    pagination(search)
    resolve = leaf(
        notes,
        "resolve",
        "Resolve an exact title, note ID or same-instance document URL",
    )
    selector = resolve.add_mutually_exclusive_group(required=True)
    selector.add_argument("--title")
    selector.add_argument("--id")
    selector.add_argument("--url")
    get = leaf(notes, "get", "Read metadata and current content version")
    get.add_argument("note_id")
    outline = leaf(notes, "outline", "Read a bounded versioned heading index")
    outline.add_argument("note_id")
    outline.add_argument("--version", type=int)
    pagination(outline)
    changes = leaf(
        notes, "changes", "List changed/deleted stable blocks since a content version"
    )
    changes.add_argument("note_id")
    changes.add_argument("--since-version", type=int, required=True)
    changes.add_argument("--version", type=int)
    pagination(changes)
    export = leaf(notes, "export", "Export one explicit content version to a file")
    export.add_argument("note_id")
    export.add_argument("--version", type=int, required=True)
    export.add_argument("--format", choices=["json", "markdown"], default="json")
    export.add_argument("--out", required=True)
    for name in ("create", "import"):
        create = leaf(
            notes,
            name,
            "Create a new document, optionally from Markdown; never replaces an existing document",
        )
        create.add_argument("--notebook", required=True)
        create.add_argument("--title", required=True)
        create.add_argument("--parent")
        create.add_argument(
            "--file", required=name == "import", help="Markdown file, or - for stdin"
        )
        create.add_argument(
            "--operation-id",
            required=True,
            help="Stable UUID for response-loss recovery",
        )
        create.add_argument(
            "--wait-seconds",
            type=float,
            default=60,
            help="Bounded import completion wait; pending results keep the original import ID",
        )
        create.add_argument(
            "--dry-run",
            action="store_true",
            help="Print validated request locally without submitting",
        )
    imports = top.add_parser(
        "imports", help="Observe and resume an existing staged Markdown import"
    ).add_subparsers(dest="command", required=True)
    for name in ("get", "finalize"):
        item = leaf(
            imports,
            name,
            "Read committed bytes and job state"
            if name == "get"
            else "Resume finalization using the same import and operation ID",
        )
        item.add_argument("import_id")
        if name == "finalize":
            item.add_argument("--wait-seconds", type=float, default=60)
    blocks = top.add_parser(
        "blocks", help="Read bounded direct children and exact stable blocks"
    ).add_subparsers(dest="command", required=True)
    page = leaf(
        blocks,
        "list",
        "Read direct siblings; inspect payload_loaded and child descriptors",
    )
    page.add_argument("--note", required=True)
    page.add_argument("--parent")
    page.add_argument("--version", type=int)
    pagination(page)
    block = leaf(blocks, "get", "Read one exact block and its revision")
    block.add_argument("block_id")
    block.add_argument("--note", required=True)
    block.add_argument("--version", type=int)
    block.add_argument("--min-version", type=int)
    operations = top.add_parser(
        "operations", help="Preview, atomically apply and recover idempotent edits"
    ).add_subparsers(dest="command", required=True)
    for name in ("preview", "apply"):
        command = leaf(
            operations,
            name,
            "Validate a batch without saving"
            if name == "preview"
            else "Atomically save a batch using its original operation_id",
        )
        command.add_argument("--note", required=True)
        command.add_argument(
            "--file",
            required=True,
            help="JSON request file, or - for stdin; inspect orbis schema",
        )
    get = leaf(
        operations, "get", "Query a committed operation result after a lost response"
    )
    get.add_argument("operation_id")
    files = top.add_parser(
        "files", help="Upload and read attachments bound to an authorized note"
    ).add_subparsers(dest="command", required=True)
    upload = leaf(
        files,
        "upload",
        "Upload a file, verify its digest and return a block reference template",
    )
    upload.add_argument("--note", required=True)
    upload.add_argument("--file", required=True)
    upload.add_argument("--operation-id", required=True)
    for name in ("get", "download"):
        command = leaf(
            files,
            name,
            "Read metadata"
            if name == "get"
            else "Download and verify attachment bytes",
        )
        command.add_argument("file_id")
        command.add_argument("--note", required=True)
        if name == "download":
            command.add_argument("--out", required=True)
    shares = top.add_parser(
        "shares", help="Manage live document sharing independently of site publication"
    ).add_subparsers(dest="command", required=True)
    listed = leaf(shares, "list", "List live shares for one authorized notebook")
    listed.add_argument("--notebook", required=True)
    pagination(listed)
    created = leaf(
        shares, "create", "Make a notebook or note hierarchy live and publicly readable"
    )
    created.add_argument("--notebook", required=True)
    created.add_argument("--root-note")
    created.add_argument(
        "--acknowledge-public-scope",
        action="store_true",
        required=True,
        help="Explicitly publish current and future descendants",
    )
    revoked = leaf(shares, "revoke", "Revoke an existing live document share")
    revoked.add_argument("share_id")
    request = top.add_parser(
        "request", help="Raw escape hatch, restricted to scoped /open/v1 APIs"
    ).add_subparsers(dest="command", required=True)
    for method in ("get", "post"):
        command = leaf(request, method, "Call a scoped public API endpoint")
        command.add_argument("path", help="Relative /open/v1 path, no foreign origin")
        if method == "post":
            command.add_argument("--file", required=True)
    api = top.add_parser(
        "api", help="Discover API methods without guessing endpoints"
    ).add_subparsers(dest="command", required=True)
    leaf(api, "ls", "List supported endpoint methods and paths")
    return parser
