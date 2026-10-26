"""Read-only mock Jira service for WEEK 5. Synthetic data only.
WARNING: X-Allowed-Project is a teaching mock, NOT production authentication.
"""
from pathlib import Path
import json
from fastapi import FastAPI, HTTPException, Header
app=FastAPI(title="Training Mock Jira", version="0.1")
ISSUES=json.loads((Path(__file__).resolve().parents[1]/"data/jira/issues.json").read_text())
PROJECTS={"ALPHA","BETA","GAMMA"}
def require_access(project: str, x_allowed_project: str|None):
    if project not in PROJECTS: raise HTTPException(404,"Project not found")
    if x_allowed_project!=project: raise HTTPException(403,"Training access denied")
@app.get("/projects/{project_key}")
def get_project_info(project_key: str,x_allowed_project: str|None=Header(default=None)):
    require_access(project_key,x_allowed_project)
    return {"project_key":project_key,"issue_count":sum(x["project_id"]==project_key for x in ISSUES)}
@app.get("/projects/{project_key}/sprints/{sprint_id}/issues")
def get_sprint_issues(project_key: str,sprint_id:int,x_allowed_project: str|None=Header(default=None)):
    require_access(project_key,x_allowed_project)
    return [i for i in ISSUES if i["project_id"]==project_key and i["sprint_id"]==sprint_id]
@app.get("/issues/{issue_key}")
def get_issue_details(issue_key:str,x_allowed_project: str|None=Header(default=None)):
    found=next((i for i in ISSUES if i["issue_key"]==issue_key),None)
    if found is None:raise HTTPException(404,"Issue not found")
    require_access(found["project_id"],x_allowed_project)
    return found
