import logging

from orbis_user_api.core.logging import ShareAccessLogFilter, safe_request_path


def test_share_path_redaction_preserves_resource_and_ordinary_paths():
    assert safe_request_path('/public/shares/secret-token/notes/123') == '/public/shares/[redacted]/notes/123'
    assert safe_request_path('/share/secret-token/123?mode=read') == '/share/[redacted]/123?mode=read'
    assert safe_request_path('/notes/123/content') == '/notes/123/content'


def test_access_logging_does_not_include_bearer_share_token():
    record = logging.LogRecord('uvicorn.access', logging.INFO, '', 0, '%s - %s %s %s %s', ('client', 'GET', '/public/shares/private-secret?offset=0', 'HTTP/1.1', 200), None)
    assert ShareAccessLogFilter().filter(record)
    assert 'private-secret' not in record.getMessage()
    assert '[redacted]?offset=0' in record.getMessage()
