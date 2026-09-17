from pathlib import Path

import pytest

from orbis_user_api.core import settings


@pytest.fixture()
def dotenv_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    root = tmp_path / ".env"
    service = tmp_path / settings._SERVICE_ROOT.name / ".env"
    service.parent.mkdir()
    root.write_text("ORBIS_DATABASE_URL=sqlite+aiosqlite:///root.db\n", encoding="utf-8")
    service.write_text("ORBIS_DATABASE_URL=sqlite+aiosqlite:///service.db\n", encoding="utf-8")
    # Preserve the real model-config order while replacing every path with a
    # temporary fixture. These tests never load the workspace's dotenv files.
    configured_paths = settings.Settings.model_config["env_file"]
    monkeypatch.setitem(settings.Settings.model_config, "env_file", tuple(
        tmp_path / Path(path).relative_to(settings._SERVICE_ROOT.parent)
        for path in configured_paths
    ))
    monkeypatch.delenv("ORBIS_DATABASE_URL", raising=False)
    return root, service


def test_service_dotenv_overrides_root_using_model_config_order(dotenv_paths: tuple[Path, Path]) -> None:
    assert settings.Settings().database_url == "sqlite+aiosqlite:///service.db"


def test_root_dotenv_is_used_when_service_file_is_missing(dotenv_paths: tuple[Path, Path]) -> None:
    dotenv_paths[1].unlink()
    assert settings.Settings().database_url == "sqlite+aiosqlite:///root.db"


def test_real_environment_overrides_both_dotenv_files(
    dotenv_paths: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ORBIS_DATABASE_URL", "sqlite+aiosqlite:///environment.db")
    assert settings.Settings().database_url == "sqlite+aiosqlite:///environment.db"
