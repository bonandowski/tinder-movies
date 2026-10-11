import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import mount_frontend


@pytest.fixture
def client(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>frontend</html>")
    (dist / "assets" / "app-123.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("segreto")

    app = FastAPI()

    @app.get("/api/ping")
    def ping():
        return {"ok": True}

    mount_frontend(app, dist)
    return TestClient(app)


def test_home_and_room_links_serve_the_frontend(client):
    for path in ("/", "/r/ABCD", "/qualsiasi/cosa"):
        response = client.get(path)
        assert response.status_code == 200
        assert "frontend" in response.text
        assert response.headers["cache-control"] == "no-cache"


def test_assets_and_root_files_are_served(client):
    assert client.get("/assets/app-123.js").text == "console.log(1)"
    assert client.get("/favicon.svg").text == "<svg/>"


def test_api_routes_still_work_and_unknown_api_paths_are_404(client):
    assert client.get("/api/ping").json() == {"ok": True}
    assert client.get("/api/non-esiste").status_code == 404
    assert client.get("/ws/ABCD").status_code == 404


def test_cannot_read_files_outside_the_build_folder(client):
    assert "segreto" not in client.get("/%2e%2e/secret.txt").text
    assert "segreto" not in client.get("/../secret.txt").text


def test_without_a_build_nothing_is_mounted(tmp_path):
    app = FastAPI()
    mount_frontend(app, tmp_path / "missing")
    assert TestClient(app).get("/").status_code == 404
