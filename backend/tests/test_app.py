import re
import pytest
from fastapi.testclient import TestClient

from app.main import STATIC_DIR, create_app


def test_board_page(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "Project board" in response.text


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_does_not_serve_html(client):
    response = client.get("/api/missing")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_static_script(client):
    response = client.get("/_next/test.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]
    assert "console.log" in response.text


@pytest.mark.parametrize("path", ["/unknown-page", "/_next/missing.js"])
def test_missing_static_resources_return_404(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert "Page not found" in response.text


def test_static_files_cannot_escape_root(client, tmp_path):
    secret = tmp_path.parent / "outside.txt"
    secret.write_text("outside-static-root", encoding="utf-8")
    response = client.get("/%2e%2e/outside.txt")
    assert response.status_code == 404
    assert "outside-static-root" not in response.text


@pytest.mark.skipif(not (STATIC_DIR / "index.html").exists(), reason="Production export is tested in Docker")
def test_real_production_export_and_assets(tmp_path):
    with TestClient(create_app(database_path=tmp_path / "export-test.db")) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "Checking your session" in response.text
        assets = re.findall(r'(?:src|href)="([^\"]+\.(?:js|css))"', response.text)
        assert assets
        for asset in assets:
            assert client.get(asset).status_code == 200
        assert client.get("/api/health").json() == {"status": "ok"}
