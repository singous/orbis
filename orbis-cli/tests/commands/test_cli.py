import json
from uuid import uuid4

from orbis_cli.main import main


def test_doctor_missing_setup_still_emits_json(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("ORBIS_CONFIG_DIR", str(tmp_path))
    for key in ("ORBIS_TOKEN", "ORBIS_BASE_URL", "ORBIS_WORKSPACE_ID"):
        monkeypatch.delenv(key, raising=False)
    assert main(["--json", "doctor"]) == 2
    output = json.loads(capsys.readouterr().out)
    assert output["code"] == "CLI_DOCTOR_FAILED"
    assert output["data"]["token_source"] == "missing"
    assert output["data"]["missing"] == ["CLI_CONFIG_MISSING"]


def test_argument_error_is_one_json_envelope(capsys):
    assert main(["--json", "notes", "list", "--limit", "1000"]) == 2
    assert json.loads(capsys.readouterr().out)["code"] == "CLI_ARGUMENT_INVALID"


def test_config_is_nonsecret_and_workspace_flags_work_after_command(
    monkeypatch, tmp_path, capsys
):
    monkeypatch.setenv("ORBIS_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("ORBIS_TOKEN", "must-not-persist")
    workspace = str(uuid4())
    assert (
        main(
            [
                "config",
                "set",
                "--json",
                "--base-url",
                "https://orbis.example/api",
                "--workspace",
                workspace,
            ]
        )
        == 0
    )
    output = json.loads(capsys.readouterr().out)
    assert output["data"]["workspace_id"] == workspace
    assert "must-not-persist" not in (tmp_path / "config.json").read_text()
    assert (tmp_path / "config.json").stat().st_mode & 0o777 == 0o600


def test_foreign_doc_url_is_rejected(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("ORBIS_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("ORBIS_BASE_URL", "https://orbis.example/api")
    monkeypatch.setenv("ORBIS_WORKSPACE_ID", str(uuid4()))
    monkeypatch.setenv("ORBIS_TOKEN", "orbis_it_secret")
    assert (
        main(
            [
                "--json",
                "notes",
                "resolve",
                "--url",
                f"https://foreign.example/documents/{uuid4()}",
            ]
        )
        == 2
    )
    assert json.loads(capsys.readouterr().out)["code"] == "CLI_FOREIGN_INSTANCE"


def test_accidental_secret_in_unknown_arguments_is_redacted(capsys):
    secret = "orbis_it_accidental_secret_in_argument"
    assert main(["--json", "doctor", "--token", secret]) == 2
    output = capsys.readouterr().out
    assert secret not in output
    assert json.loads(output)["code"] == "CLI_ARGUMENT_INVALID"


def test_import_observation_wait_rejects_nonfinite_values(
    monkeypatch, tmp_path, capsys
):
    monkeypatch.setenv("ORBIS_CONFIG_DIR", str(tmp_path))
    assert (
        main(["--json", "imports", "finalize", "import-id", "--wait-seconds", "nan"])
        == 2
    )
    assert json.loads(capsys.readouterr().out)["code"] == "CLI_WAIT_INVALID"
