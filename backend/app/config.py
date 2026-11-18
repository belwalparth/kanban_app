import os
from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AuthSettings:
    base_url: str
    client_id: str
    client_secret: str
    secure: bool

    @property
    def google_enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)

    @property
    def callback_url(self) -> str:
        return self.base_url + "/api/auth/google/callback"


def auth_settings(environment: str, secret: str | None) -> AuthSettings:
    base_url = os.environ.get("APP_BASE_URL", "http://localhost:8000")
    parsed = urlsplit(base_url)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username
            or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise RuntimeError("APP_BASE_URL must be an origin without a path or trailing slash")
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if bool(client_id) != bool(client_secret):
        raise RuntimeError("Configure both Google client settings")
    if environment != "local":
        if parsed.scheme != "https" or not os.environ.get("APP_BASE_URL") or not client_id:
            raise RuntimeError("Cloud mode requires HTTPS APP_BASE_URL and Google client settings")
    if (environment != "local" or client_id) and (not secret or len(secret) < 32):
        raise RuntimeError("Google/cloud sessions require SESSION_SECRET of at least 32 characters")
    return AuthSettings(base_url, client_id, client_secret, parsed.scheme == "https")
