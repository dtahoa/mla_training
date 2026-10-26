from fastapi.testclient import TestClient
from app.mock_jira import app
client=TestClient(app)
def test_read_only_jira_issues():
    r=client.get('/projects/ALPHA/sprints/12/issues',headers={'X-Allowed-Project':'ALPHA'})
    assert r.status_code==200 and len(r.json())==10

def test_cross_project_denied():
    r=client.get('/projects/BETA/sprints/12/issues',headers={'X-Allowed-Project':'ALPHA'})
    assert r.status_code==403

def test_no_write_endpoint():
    r=client.post('/issues/ALPHA-101',json={'status':'Done'},headers={'X-Allowed-Project':'ALPHA'})
    assert r.status_code==405 or r.status_code==404
