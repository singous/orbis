from __future__ import annotations

import json
import os
import re
import sys

from .commands import execute
from .errors import CliError
from .parser import build_parser


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    machine = "--json" in arguments
    try:
        args = build_parser().parse_args(arguments)
        result = execute(args)
        print(json.dumps(result, ensure_ascii=False, indent=None if machine else 2))
        return 0
    except CliError as exc:
        secret = os.environ.get("ORBIS_TOKEN")
        rendered = json.dumps(exc.payload, ensure_ascii=False)
        if secret:
            rendered = rendered.replace(secret, "[REDACTED]")
        rendered = re.sub(r"orbis_it_[A-Za-z0-9_-]+", "[REDACTED]", rendered)
        rendered = re.sub(r"(https?://)[^/\s\"]+@", r"\1[REDACTED]@", rendered)
        if machine:
            print(rendered)
        else:
            safe_error = json.loads(rendered)
            print(safe_error["code"] + ": " + safe_error["message"], file=sys.stderr)
        return exc.exit_code
    except (KeyboardInterrupt, BrokenPipeError):
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
