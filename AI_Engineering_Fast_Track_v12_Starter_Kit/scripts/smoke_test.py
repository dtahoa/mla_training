from pathlib import Path
import json
p=Path(__file__).resolve().parents[1]
checks={'documents':len(list((p/'data/documents').glob('*.md')))+len(list((p/'data/documents').glob('*.txt'))),
'jira_issues':len(json.loads((p/'data/jira/issues.json').read_text())),
'issue_cases':len(json.loads((p/'data/evaluation/issue_classification_gold.json').read_text())),
'retrieval_cases':len(json.loads((p/'data/evaluation/retrieval_gold.json').read_text())),
'rag_cases':len(json.loads((p/'data/evaluation/rag_gold.json').read_text())),
'agent_cases':len(json.loads((p/'data/evaluation/agent_cases.json').read_text())),
'security_cases':len(json.loads((p/'data/evaluation/security_cases.json').read_text()))}
for k,n in checks.items(): print(f'{k:18s} {n}')
assert checks=={'documents':15,'jira_issues':30,'issue_cases':20,'retrieval_cases':20,'rag_cases':30,'agent_cases':20,'security_cases':10}
print('PASS - fixture files and counts are consistent')
