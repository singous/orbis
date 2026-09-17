"""Run an isolated API for the browser suite without loading deployment dotenv."""
from pathlib import Path
import os
import secrets
import sys

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "orbis-user-api" / "src"))

from orbis_user_api.core.settings import Settings  # noqa: E402
from orbis_user_api.main import create_app  # noqa: E402

runtime = Path(os.environ["ORBIS_E2E_DIR"])
runtime.mkdir(parents=True, exist_ok=True)
settings = Settings(
    _env_file=None,
    database_url=f"sqlite+aiosqlite:///{runtime / 'app.db'}",
    storage_dir=runtime / "files",
    auto_create_tables=True,
    access_token_secret=secrets.token_urlsafe(48),
    refresh_token_secret=secrets.token_urlsafe(48),
    action_token_secret=secrets.token_urlsafe(48),
    mail_transport="outbox",
    mail_outbox_dir=runtime / "outbox",
    user_web_base_url="http://127.0.0.1:9310",
)
uvicorn.run(create_app(settings), host="127.0.0.1", port=9311, log_level="warning")
