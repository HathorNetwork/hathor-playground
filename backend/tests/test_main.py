"""Basic integration tests for main FastAPI app."""

import sys
import types
from pathlib import Path
from fastapi import APIRouter
from fastapi.testclient import TestClient

# The ai_assistant module used in main.py has syntax issues in this repo.
# Provide a minimal stub so we can import the FastAPI app for testing.

# Ensure backend directory is on path for module resolution
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT_DIR))

api_module = types.ModuleType("api")
ai_module = types.ModuleType("api.ai_assistant")
ai_module.router = APIRouter()
api_module.ai_assistant = ai_module
sys.modules.setdefault("api", api_module)
sys.modules.setdefault("api.ai_assistant", ai_module)

from main import app  # noqa: E402

client = TestClient(app)


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Nano Contracts IDE API"
    assert data["version"] == "1.0.0"


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
