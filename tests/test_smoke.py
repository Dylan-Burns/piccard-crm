import os
os.environ['DATABASE_URL']='sqlite:///:memory:'
os.environ['APP_SECRET']='test-secret'
from fastapi.testclient import TestClient
from server.main import app

def test_health():
    assert TestClient(app).get('/api/health').json()['ok'] is True
