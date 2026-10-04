from __future__ import annotations

EXIT_CODES = {
    401: 3,
    403: 4,
    404: 2,
    409: 5,
    413: 2,
    422: 2,
    429: 6,
    500: 7,
    502: 7,
    503: 7,
}


class CliError(Exception):
    def __init__(
        self, code: str, message: str, *, data=None, exit_code=2, request_id=None
    ):
        super().__init__(message)
        self.payload = {
            "code": code,
            "message": message,
            "request_id": request_id,
            "data": data,
        }
        self.exit_code = exit_code


class NetworkError(CliError):
    def __init__(
        self, message="Unable to reach the configured Orbis instance", *, data=None
    ):
        super().__init__("CLI_NETWORK_ERROR", message, data=data, exit_code=6)
