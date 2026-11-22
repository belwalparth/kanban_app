"""Opt-in disposable browser fixture; packaged only in the Docker test target."""
import json
import os
import sys
import time
from base64 import b64encode
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    if (os.environ.get("KANBAN_DISPOSABLE_E2E") != "1" or os.environ.get("APP_ENV") != "local"
            or os.environ.get("APP_BASE_URL") != "http://localhost:8003"):
        raise RuntimeError("Browser fixture requires disposable local mode on localhost:8003")
    import uvicorn
    from itsdangerous import TimestampSigner
    from app.auth import SESSION_COOKIE
    from app.database import GOOGLE_ISSUER, initialize, provision_google_user
    from app.main import create_app

    database = Path("/tmp/part20-disposable.db")
    secret = "part20-disposable-session-secret-only"
    initialize(database)
    sessions = {}
    for subject in ("owner", "first", "second"):
        user = provision_google_user(database, issuer=GOOGLE_ISSUER, subject=f"part20-{subject}",
                                     email=f"{subject}@example.test", display_name=f"Test {subject}", email_verified=True)
        payload = {"user_id": user.id, "expires_at": int(time.time()) + 8 * 3600}
        cookie = TimestampSigner(secret).sign(b64encode(json.dumps(payload).encode())).decode()
        sessions[subject] = {"id": user.id, "cookie": {"name": SESSION_COOKIE, "value": cookie,
            "domain": "localhost", "path": "/", "httpOnly": True, "secure": False, "sameSite": "Lax"}}
    Path("/tmp/part20-sessions.json").write_text(json.dumps(sessions))
    app = create_app(database_path=database, session_secret=secret, allow_demo_login=True)
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
