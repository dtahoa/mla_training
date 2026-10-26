# Training-only evaluation fixtures

These are **illustrative public fixtures** so members can reproduce local checks. An AI Lead should independently maintain 20–30% **hidden** scenarios OUTSIDE this shared starter kit for final assessments.

- `issue_classification_gold.json`: 20 labeled issues
- `retrieval_gold.json`: 20 queries with relevant document IDs; for strict Recall@5 use a mentor-reviewed relevance set because more than one source may support a repeated fact
- `rag_gold.json`: 30 questions including unknown and unauthorized cases
- `agent_cases.json`: 20 scenarios (includes unauthorized requests)
- `security_cases.json`: 10 adversarial and safety scenarios

No real customer/project confidential data is included.
