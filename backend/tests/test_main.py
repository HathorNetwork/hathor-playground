"""Basic integration tests for main FastAPI app."""

import sys
import types
from pathlib import Path
from fastapi import APIRouter
from fastapi.testclient import TestClient
from slowapi import Limiter
from slowapi.util import get_remote_address

# Provide minimal stubs for modules used in main.py

# Ensure backend directory is on path for module resolution
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT_DIR))

# Mock middleware module
middleware_module = types.ModuleType("middleware")
rate_limit_module = types.ModuleType("middleware.rate_limit")

# Create mock objects
rate_limit_module.limiter = Limiter(
    key_func=get_remote_address, storage_uri="memory://")
rate_limit_module.token_limit_middleware = lambda request, \
    call_next: call_next(
        request)
rate_limit_module.rate_limit_exceeded_handler = lambda request, exc: None

middleware_module.rate_limit = rate_limit_module
sys.modules.setdefault("middleware", middleware_module)
sys.modules.setdefault("middleware.rate_limit", rate_limit_module)

# Mock API module
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
