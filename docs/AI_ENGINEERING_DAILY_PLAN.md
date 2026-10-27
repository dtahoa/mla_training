# AI Engineering Fast-Track — GitHub Daily Execution Plan

> **Period:** 19 October – 11 December 2026    
> **Workload:** 20 hours/week (\~4h per weekday) = 4h learning + 6h individual lab + 8h team capstone + 2h review    
> **Project:** AI-Powered Delivery Assistant — synthetic project documents + read-only mock Jira    
> **Status:** Planning template only. No tasks, evaluations, PRs or gates are assumed completed.

**Source of requirements:** `TMA_AI_Engineering_Fast_Track_Member_Package_v12_Self_Learning_Ready 1.pptx` (51 slides), particularly slides 7–8, 10–13, 18–19, 22–37, 39–44, 46–50. **Suggested daily breakdown, task IDs, commands, file locations, timing and some implementation examples below are a proposed execution plan**, not mandatory details specified by the deck. The companion starter-kit ZIP is described in the deck but was **not provided for inspection**; check and adapt paths/commands to your actual repository.

## How to use in GitHub

1. Commit this file as `docs/AI_ENGINEERING_DAILY_PLAN.md` (or at repo root).
2. Every morning, open the current day; choose its task IDs and link GitHub Issues or a PR to them. Do not pre-tick tasks.
3. Update checkboxes and a daily report at the end of each day. Link real commits, PRs, test logs and eval CSVs.
4. On Wednesday, review architecture, blockers and scope. On Friday, run the acceptance suite, submit PR + evidence + 5–10 min demo and capture mentor outcome.
5. Carry unfinished tasks forward explicitly. A deadline and a score are not proof of passing; a mentor must record gate results.

### Status legend and operating rules

- `NOT_STARTED` — no evidence; `IN_PROGRESS` — partial work; `BLOCKED` — actionable blocker; `SUBMITTED` — PR/evidence submitted; `PASS` / `REWORK` — reviewer-confirmed outcome.
- Each task closes only when its **acceptance criterion** is demonstrated with the requested **evidence**.
- **P0** = essential for that week / gate; **P1** = supports delivery and quality. Priorities are proposed planning guidance.
- Each weekday budget: **4 hours**. Flexible default split: learning 45 min, building 2h15, testing 40 min, evidence/report 20 min; Monday/Wednesday/Friday may differ. Across each week aim at the deck’s **4/6/8/2-hour** allocations; individual tasks often support more than one bucket.
- Never add real customer data or credentials. Use synthetic fixtures and approved API access/cost cap.

## MVP scope and success criteria (from deck)


| ID  | Capability                  | Non-negotiable behavior                                                                               |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| F01 | Project Knowledge Q&amp;A   | Grounded Q&amp;A with document/page citation; abstain when unsupported; enforce project permissions.  |
| F02 | Sprint Health Analysis      | Read-only Jira; grounded blocked/overdue issue keys, statuses and owners.                             |
| F03 | Weekly Status Draft         | Evidence-backed, editable progress/risks/blockers/actions; capstone target ≤2 minutes on sample data. |
| F04 | PM Review &amp; Permissions | PM review/approval before sending or writing; audit actions; zero cross-project leakage.              |


**Reference stack from deck:** Python 3.11+, FastAPI, Pydantic, OpenAI API / Agents SDK, PostgreSQL + pgvector, read-only mock Jira, Docker, AWS staging (deck reference; approval may determine staging target). **Out of scope:** live customer data, autonomous Jira writes, complex multi-agent routing.

**Mandatory gate dates:** Gate 1 — 30/10 (LLM API), Gate 2 — 13/11 (secure RAG), Gate 3 — 27/11 (agent + approval), Final — 11/12 (staging/integrated MVP). A leaked secret, cross-project exposure or unauthorized write is a gate failure regardless of scores.

## Master roadmap


| Week | Date        | Goal                                                     | Deliverable                                                                                        | Gate              |
| ---- | ----------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| W1   | 19–23/10    | Prompt Engineering &amp; Issue Classification            | Issue classifier; prompts V1–V3; 20 labelled cases; eval.csv; 5-minute demo                        | Friday checkpoint |
| W2   | 26–30/10    | LLM API &amp; Structured Meeting Notes                   | POST /analyze-meeting; typed summary/decisions/actions/owners/dates; 20-case eval; 5 failure tests | Gate 1            |
| W3   | 02–06/11    | Embeddings &amp; Project-Scoped Search                   | Index 15 synthetic documents; metadata-aware top-5 search; Recall@5 report                         | Friday checkpoint |
| W4   | 09–13/11    | Grounded RAG Knowledge Assistant                         | Project-scoped /ask; 30 Q&amp;A cases; citation review; access tests                               | Gate 2            |
| W5   | 16–20/11    | Read-Only Jira Analysis Agent                            | Three Jira read-only tools; agent with tool traces; 20-scenario evaluation                         | Friday checkpoint |
| W6   | 23–27/11    | Weekly Reporting &amp; PM Approval Workflow              | Reviewable weekly draft and explicit PM approval; 10-case workflow eval                            | Gate 3            |
| W7   | 30/11–04/12 | Security, GenAIOps &amp; Staging Deployment              | Staging URL; CI pipeline; security tests; token/latency/tool traces                                | Friday checkpoint |
| W8   | 07–11/12    | Integrated Delivery Assistant &amp; Individual Challenge | Integrated staging MVP; three business demos; independent technical challenge                      | FINAL             |


## Suggested repository layout

```text
README.md
docs/AI_ENGINEERING_DAILY_PLAN.md
docs/architecture.md
app/                       # FastAPI backend and services
app/services/              # LLM adapter, RAG, agents
app/tools/                 # Strict read-only Jira functions
app/workflows/             # Draft/review state and approval
prompts/                   # W1 V1/V2/V3, later prompt versions
data/                      # Approved synthetic fixtures only
data/evaluation/           # Labelled benchmark cases
db/migrations/             # pgvector + project scoping schema
scripts/                   # Repeatable smoke/eval runners
tests/                     # Unit, integration, security regression
evidence/W1/ ... W8/      # Generated CSV/results, sanitized traces
notes/                     # Learning notes, daily logs
```

**Before W1 / onboarding:** unzip the starter kit and inspect its `README.md`; install Python 3.11+, Git, Docker, create venv and install requirements; run `python scripts/smoke_test.py` (expected PASS and correct fixture counts), then `pytest -q tests/test_mock_jira.py` (deck expects 3 passed). Obtain approved LLM API access, limits and repo/staging info from AI Lead. Run these commands only where the companion starter kit contains those paths.

## Repeatable validation commands (adapt to repository)

```bash
python -m venv .venv
source .venv/bin/activate       # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scripts/smoke_test.py   # only if starter kit contains it
pytest -q tests/test_mock_jira.py
uvicorn app.main:app --reload # when app/main.py is implemented
pytest -q
git status --short
git diff --check
```

**Proposed scripts (create them; not guaranteed in starter kit):** `python scripts/eval_issue.py --prompt prompts/v3.md --out evidence/W1/eval.csv`, `python scripts/eval_meeting.py --out evidence/W2/eval.csv`, `python scripts/eval_retrieval.py --out evidence/W3/retrieval_eval.csv`, `python scripts/eval_rag.py --out evidence/W4/qa_eval.csv`, `python scripts/eval_agent.py --out evidence/W5/agent_eval.csv`, `python scripts/eval_workflow.py --out evidence/W6/workflow_eval.csv`. Each script should emit case ID, gold reference, output, pass/fail/reason, version info and summary metrics; **these command names are examples to implement, not claims that the ZIP includes them**.

## Weekly acceptance and day-by-day tasks

## W1 — Prompt Engineering &amp; Issue Classification (19–23/10 2026)

**Goal:** Foundation — reliable prompts, JSON classification.  **Expected deliverable:** Issue classifier; prompts V1–V3; 20 labelled cases; eval.csv; 5-minute demo.

**Week-level pass criteria (from deck):**

- [ ] Category accuracy ≥85% (≥17/20)
- [ ] 100% successful outputs comply with agreed JSON schema
- [ ] Detect every critical test incident as P1
- [ ] Explain V3 improvements compared with V1

**Carryover rule as of 26/10:** W1 ended 23/10; verify its actual submission, metrics, PR and demo. Any unverified or missing evidence stays `NOT_VERIFIED` / carryover; never mark W1 PASS by assumption.

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W1-MON — Monday, 19/10/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [x] **W1-MON-01 · P1** — **Task:** Define a 20-case synthetic dataset, categories Bug/Feature/Question/Risk, priorities P1/P2/P3.  \\

  **Expected / DoD:** Define human-reviewed gold labels and mark critical incidents.    
  **Evidence:** `data/issues.jsonl with case_id, text, expected_category, expected_priority, critical flag`.
- [ ] **W1-MON-02 · P1** — **Task:** Review basics of system/user messages, few-shot examples, structured JSON prompts.  \\

  **Expected / DoD:** Record three prompt design principles.    
  **Evidence:** `notes/W1-learning.md`.
- [ ] **W1-MON-03 · P1** — **Task:** Set up Python project, validator and sample baseline.  \\

  **Expected / DoD:** One case can be parsed and validated.    
  **Evidence:** `code commit plus test output`.

**End-of-day checkpoint (W1-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W1-TUE — Tuesday, 20/10/2026 · target 4h

- [ ] **W1-TUE-01 · P0** — **Task:** Build prompt V1: simple baseline classification.  \\

  **Expected / DoD:** V1 contains explicit categories, priority and next\_action expectations.    
  **Evidence:** `prompts/v1.md`.
- [ ] **W1-TUE-02 · P1** — **Task:** Implement inference runner with stable output and error recording.  \\

  **Expected / DoD:** Every case has response or explicit failure reason.    
  **Evidence:** `scripts/run_eval.py`.
- [ ] **W1-TUE-03 · P1** — **Task:** Run all 20 against V1; record error taxonomy.  \\

  **Expected / DoD:** Same gold set; no fabricated reference labels.    
  **Evidence:** `evidence/W1/v1-results.csv`.

**End-of-day checkpoint (W1-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W1-WED — Wednesday, 21/10/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W1-WED-01 · P0** — **Task:** Architecture/prompt review: analyze V1 category/P1 misses.  \\

  **Expected / DoD:** Error summary by category, priority, invalid JSON.    
  **Evidence:** `evidence/W1/error-analysis.md`.
- [ ] **W1-WED-02 · P1** — **Task:** Build V2: explicit label definitions, output schema and constraints.  \\

  **Expected / DoD:** V2 documented and versioned.    
  **Evidence:** `prompts/v2.md`.
- [ ] **W1-WED-03 · P1** — **Task:** Build negative/edge cases and pytest validation.  \\

  **Expected / DoD:** Invalid class/priority/missing fields rejected.    
  **Evidence:** `tests/test_classifier_schema.py`.

**End-of-day checkpoint (W1-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W1-THU — Thursday, 22/10/2026 · target 4h

- [ ] **W1-THU-01 · P0** — **Task:** Build V3: few-shot examples and critical-incident priority guardrails.  \\

  **Expected / DoD:** V3 documents examples, non-guessing and output format.    
  **Evidence:** `prompts/v3.md`.
- [ ] **W1-THU-02 · P1** — **Task:** Run V1/V2/V3 on exactly the same 20 cases.  \\

  **Expected / DoD:** Metrics per prompt version and P1 misses.    
  **Evidence:** `evidence/W1/eval.csv`.
- [ ] **W1-THU-03 · P1** — **Task:** Investigate remaining failures and explain trade-offs.  \\

  **Expected / DoD:** Root causes and chosen prompt rationale recorded.    
  **Evidence:** `evidence/W1/comparison.md`.

**End-of-day checkpoint (W1-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W1-FRI — Friday, 23/10/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W1-FRI-01 · P0** — **Task:** Final W1 evaluation, schema checks and P1 audit.  \\

  **Expected / DoD:** ≥85% category; valid outputs; no missed critical P1.    
  **Evidence:** `test logs + final eval.csv`.
- [ ] **W1-FRI-02 · P0** — **Task:** Open PR with prompts, 20 labels, reproduction commands.  \\

  **Expected / DoD:** Reviewer can reproduce evaluation.    
  **Evidence:** `PR URL + commit SHA + README`.
- [ ] **W1-FRI-03 · P0** — **Task:** Deliver \~5-minute demo and document mentor outcome.  \\

  **Expected / DoD:** Demo covers case, V1→V3 gains and failure analysis.    
  **Evidence:** `demo recording/link + mentor notes`.

**End-of-day checkpoint (W1-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## W2 — LLM API &amp; Structured Meeting Notes (26–30/10 2026)

**Goal:** Foundation / GATE 1 — typed API and resilience.  **Expected deliverable:** POST /analyze-meeting; typed summary/decisions/actions/owners/dates; 20-case eval; 5 failure tests.

**Week-level pass criteria (from deck):**

- [ ] API starts via documented README and exposes OpenAPI
- [ ] 100% successful responses match JSON schema
- [ ] Fact/action extraction accuracy ≥85% on 20 labelled cases
- [ ] 5/5 negative/error scenarios pass; no API key in Git/logs

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W2-MON — Monday, 26/10/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [ ] **W2-MON-01 · P1** — **Task:** Review W1 submission; log missing deliverables as carryover, never assume passed.  \\

  **Expected / DoD:** W1 evidence checklist has verified / missing states.    
  **Evidence:** `evidence/W1/carryover.md`.
- [ ] **W2-MON-02 · P1** — **Task:** Study OpenAI Quickstart + Structured Outputs and typed response contracts.  \\

  **Expected / DoD:** Describe why server-side validation is necessary.    
  **Evidence:** `notes/W2-learning.md`.
- [ ] **W2-MON-03 · P1** — **Task:** Design MeetingRequest, Summary, Decision, ActionItem schemas.  \\

  **Expected / DoD:** Missing owner/due\_date support null; required fields clearly defined.    
  **Evidence:** `app/schemas.py + schema tests`.
- [ ] **W2-MON-04 · P1** — **Task:** Create FastAPI POST /analyze-meeting skeleton and OpenAPI smoke test.  \\

  **Expected / DoD:** Endpoint reachable; invalid input rejected.    
  **Evidence:** `app/main.py + smoke command`.

**End-of-day checkpoint (W2-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W2-TUE — Tuesday, 27/10/2026 · target 4h

- [ ] **W2-TUE-01 · P0** — **Task:** Create separate LLM service adapter using environment-managed secrets.  \\

  **Expected / DoD:** Business endpoint not coupled to provider SDK.    
  **Evidence:** `app/services/llm.py`.
- [ ] **W2-TUE-02 · P1** — **Task:** Implement schema-constrained meeting extraction.  \\

  **Expected / DoD:** Summary, decisions, action owner/date returned from explicit source facts.    
  **Evidence:** `example request/response JSON`.
- [ ] **W2-TUE-03 · P1** — **Task:** Test missing owners, ambiguous dates and empty meeting notes.  \\

  **Expected / DoD:** Missing values stay null; no invented ISO dates.    
  **Evidence:** `tests/test_meeting_extraction.py`.

**End-of-day checkpoint (W2-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W2-WED — Wednesday, 28/10/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W2-WED-01 · P0** — **Task:** Review API boundaries, validation and error-mapping design.  \\

  **Expected / DoD:** Document response shape, errors, retries/timeout policy.    
  **Evidence:** `docs/W2-architecture-review.md`.
- [ ] **W2-WED-02 · P1** — **Task:** Implement bounded timeout + 429 handling.  \\

  **Expected / DoD:** Clear API response; no unbounded retry.    
  **Evidence:** `tests/test_upstream_errors.py`.
- [ ] **W2-WED-03 · P1** — **Task:** Handle upstream 500, malformed model output and invalid payload.  \\

  **Expected / DoD:** 5 named negative cases reproducible with mocked provider.    
  **Evidence:** `failure matrix + pytest results`.

**End-of-day checkpoint (W2-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W2-THU — Thursday, 29/10/2026 · target 4h

- [ ] **W2-THU-01 · P0** — **Task:** Prepare 20 human-labelled meeting cases.  \\

  **Expected / DoD:** Gold facts/actions/owners/dates independently reviewed.    
  **Evidence:** `data/evaluation/meeting_gold.jsonl`.
- [ ] **W2-THU-02 · P1** — **Task:** Run extraction evaluator and audit case-level evidence.  \\

  **Expected / DoD:** Report correct/total according to documented matching rubric.    
  **Evidence:** `evidence/W2/eval.csv`.
- [ ] **W2-THU-03 · P1** — **Task:** Fix schema/extraction issues and audit logs/secrets.  \\

  **Expected / DoD:** Meets ≥85% and no secret leakage evidence.    
  **Evidence:** `test report + git secret check`.

**End-of-day checkpoint (W2-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W2-FRI — Friday, 30/10/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W2-FRI-01 · P0** — **Task:** Run full API, schema, extraction and 5 failure tests.  \\

  **Expected / DoD:** Schema 100%; extraction ≥85%; 5/5 failures pass.    
  **Evidence:** `pytest report + eval.csv`.
- [ ] **W2-FRI-02 · P0** — **Task:** Open PR with API examples, README and secure configuration.  \\

  **Expected / DoD:** Reviewer runs API and tests using documented commands.    
  **Evidence:** `PR URL + commit SHA`.
- [ ] **W2-FRI-03 · P0** — **Task:** Record screen demo and Gate 1 mentor assessment.  \\

  **Expected / DoD:** Gate 1 marked Pass only after actual review.    
  **Evidence:** `demo link + signed result / blockers`.

**End-of-day checkpoint (W2-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## W3 — Embeddings &amp; Project-Scoped Search (02–06/11 2026)

**Goal:** F01 retrieval — project-aware semantic search.  **Expected deliverable:** Index 15 synthetic documents; metadata-aware top-5 search; Recall@5 report.

**Week-level pass criteria (from deck):**

- [ ] 15/15 synthetic documents indexed
- [ ] Recall@5 ≥80% across 20 labelled retrieval queries
- [ ] Top-5 chunks show source/page and stable project metadata
- [ ] No unauthorized project chunks returned; project filter enforced during retrieval

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W3-MON — Monday, 02/11/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [ ] **W3-MON-01 · P1** — **Task:** Inspect 15 approved synthetic docs, manifest and project IDs.  \\

  **Expected / DoD:** Inventory count 15; no customer data.    
  **Evidence:** `evidence/W3/document-inventory.md`.
- [ ] **W3-MON-02 · P1** — **Task:** Study embeddings, chunking, top-k and Recall@5.  \\

  **Expected / DoD:** Explain precision/retrieval trade-offs.    
  **Evidence:** `notes/W3-learning.md`.
- [ ] **W3-MON-03 · P1** — **Task:** Design pgvector schema with project\_id and source/page metadata.  \\

  **Expected / DoD:** DDL reviewed and migration reproducible.    
  **Evidence:** `db/migrations + design notes`.

**End-of-day checkpoint (W3-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W3-TUE — Tuesday, 03/11/2026 · target 4h

- [ ] **W3-TUE-01 · P0** — **Task:** Build PDF/TXT/Markdown extraction with source offsets.  \\

  **Expected / DoD:** Same input produces consistent source references.    
  **Evidence:** `app/ingest/extract.py + tests`.
- [ ] **W3-TUE-02 · P1** — **Task:** Implement \~500–800 token chunk baseline with moderate overlap.  \\

  **Expected / DoD:** Chunk IDs deterministic; source/page retained.    
  **Evidence:** `app/ingest/chunk.py + sample output`.
- [ ] **W3-TUE-03 · P1** — **Task:** Add idempotent ingestion keyed by document/content hash.  \\

  **Expected / DoD:** Re-runs do not multiply unchanged chunks.    
  **Evidence:** `ingestion unit tests`.

**End-of-day checkpoint (W3-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W3-WED — Wednesday, 04/11/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W3-WED-01 · P0** — **Task:** Review chunk strategy, access boundaries and embedding cost.  \\

  **Expected / DoD:** Architecture decisions and risks recorded.    
  **Evidence:** `docs/W3-review.md`.
- [ ] **W3-WED-02 · P1** — **Task:** Generate embeddings for changed chunks; insert into pgvector.  \\

  **Expected / DoD:** Chunks persisted with source/project IDs.    
  **Evidence:** `app/ingest/index.py + DB verification`.
- [ ] **W3-WED-03 · P1** — **Task:** Build retrieval SQL with project filter applied before top-k.  \\

  **Expected / DoD:** Unauthorized chunks cannot enter retrieval candidates.    
  **Evidence:** `security SQL tests`.

**End-of-day checkpoint (W3-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W3-THU — Thursday, 05/11/2026 · target 4h

- [ ] **W3-THU-01 · P0** — **Task:** Expose project-scoped top-5 search with metadata.  \\

  **Expected / DoD:** Returns chunk text plus document/page IDs.    
  **Evidence:** `app/search.py + examples`.
- [ ] **W3-THU-02 · P1** — **Task:** Prepare and run 20 labelled retrieval cases.  \\

  **Expected / DoD:** Recall@5 computed from independently labelled expected docs/chunks.    
  **Evidence:** `evidence/W3/retrieval_eval.csv`.
- [ ] **W3-THU-03 · P1** — **Task:** Tune chunk overlap or query strategy with documented trade-offs.  \\

  **Expected / DoD:** Recall@5 ≥80% or explicit failure diagnosis.    
  **Evidence:** `evidence/W3/analysis.md`.

**End-of-day checkpoint (W3-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W3-FRI — Friday, 06/11/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W3-FRI-01 · P0** — **Task:** Run ingestion, authorization and retrieval regression suite.  \\

  **Expected / DoD:** 15/15; Recall@5 ≥80%; no unauthorized chunks.    
  **Evidence:** `test/eval logs`.
- [ ] **W3-FRI-02 · P0** — **Task:** Submit schema, code, README and retrieval report in PR.  \\

  **Expected / DoD:** Search fully reproducible.    
  **Evidence:** `PR + commit SHA`.
- [ ] **W3-FRI-03 · P0** — **Task:** Demo relevant and denied project searches.  \\

  **Expected / DoD:** Demo includes source metadata and cross-project rejection.    
  **Evidence:** `demo link + mentor notes`.

**End-of-day checkpoint (W3-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## W4 — Grounded RAG Knowledge Assistant (09–13/11 2026)

**Goal:** F01 / GATE 2 — cited answers, no-answer, authorization.  **Expected deliverable:** Project-scoped /ask; 30 Q&amp;A cases; citation review; access tests.

**Week-level pass criteria (from deck):**

- [ ] ≥85% correct answers on 30 fixed questions
- [ ] ≥90% of citations support cited claims
- [ ] All known unanswerable cases abstain instead of guessing
- [ ] Zero cross-project leakage in security suite

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W4-MON — Monday, 09/11/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [ ] **W4-MON-01 · P1** — **Task:** Review W3 retrieval results and carryover.  \\

  **Expected / DoD:** All unresolved retrieval issues triaged.    
  **Evidence:** `W3 carryover notes`.
- [ ] **W4-MON-02 · P1** — **Task:** Study grounded RAG and citation verification.  \\

  **Expected / DoD:** Describe why fluency is not correctness.    
  **Evidence:** `notes/W4-learning.md`.
- [ ] **W4-MON-03 · P1** — **Task:** Design /ask input/output contract and citation shape.  \\

  **Expected / DoD:** Each answer can carry document/page citation.    
  **Evidence:** `app/schemas.py + endpoint contract`.

**End-of-day checkpoint (W4-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W4-TUE — Tuesday, 10/11/2026 · target 4h

- [ ] **W4-TUE-01 · P0** — **Task:** Wire authorized retrieval → evidence-only answer generation.  \\

  **Expected / DoD:** Retrieved chunks scoped to user and project.    
  **Evidence:** `app/services/rag.py`.
- [ ] **W4-TUE-02 · P1** — **Task:** Generate claim-level source/page citations.  \\

  **Expected / DoD:** Reviewer can inspect referenced passage.    
  **Evidence:** `citation output examples`.
- [ ] **W4-TUE-03 · P1** — **Task:** Add explicit no-answer when supporting evidence absent.  \\

  **Expected / DoD:** No fabricated unsupported dates or actions.    
  **Evidence:** `unknown-case tests`.

**End-of-day checkpoint (W4-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W4-WED — Wednesday, 11/11/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W4-WED-01 · P0** — **Task:** Architecture/access review: authorization, prompt injection, conflicting versions.  \\

  **Expected / DoD:** Threats and evidence handling recorded.    
  **Evidence:** `docs/W4-security-review.md`.
- [ ] **W4-WED-02 · P1** — **Task:** Implement conflicting-document behavior with both sources.  \\

  **Expected / DoD:** Conflicts stated with both citations.    
  **Evidence:** `tests/test_conflicts.py`.
- [ ] **W4-WED-03 · P1** — **Task:** Implement cross-project negative tests and malicious chunk examples.  \\

  **Expected / DoD:** Unauthorized document content/citations never exposed.    
  **Evidence:** `security test report`.

**End-of-day checkpoint (W4-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W4-THU — Thursday, 12/11/2026 · target 4h

- [ ] **W4-THU-01 · P0** — **Task:** Evaluate 30 fixed QA scenarios including known/unknown/conflicts.  \\

  **Expected / DoD:** Correctness count and individual failures recorded.    
  **Evidence:** `evidence/W4/qa_eval.csv`.
- [ ] **W4-THU-02 · P1** — **Task:** Manually verify citation support rate.  \\

  **Expected / DoD:** ≥90% citation-grounding according to documented rubric.    
  **Evidence:** `evidence/W4/citation_audit.csv`.
- [ ] **W4-THU-03 · P1** — **Task:** Fix RAG failures and rerun access checks.  \\

  **Expected / DoD:** No cross-project leakage; all unknown test cases abstain.    
  **Evidence:** `regression logs`.

**End-of-day checkpoint (W4-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W4-FRI — Friday, 13/11/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W4-FRI-01 · P0** — **Task:** Execute full Gate 2 eval, citation and security suite.  \\

  **Expected / DoD:** Meet QA/citation thresholds and strict safety requirements.    
  **Evidence:** `eval/security results`.
- [ ] **W4-FRI-02 · P0** — **Task:** Submit RAG PR with repeatable command and visible citations.  \\

  **Expected / DoD:** Reviewer can reproduce 30 cases.    
  **Evidence:** `PR URL + README`.
- [ ] **W4-FRI-03 · P0** — **Task:** Demo cited Q&amp;A, unanswered query and access denial.  \\

  **Expected / DoD:** Gate 2 decision explicitly recorded.    
  **Evidence:** `demo + mentor scorecard`.

**End-of-day checkpoint (W4-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## W5 — Read-Only Jira Analysis Agent (16–20/11 2026)

**Goal:** F02 — safe tools and deterministic sprint insights.  **Expected deliverable:** Three Jira read-only tools; agent with tool traces; 20-scenario evaluation.

**Week-level pass criteria (from deck):**

- [ ] All three tools covered by tests
- [ ] Tool selection accuracy ≥85% on 20 scenarios
- [ ] Issue keys/statuses taken from mock Jira; never fabricated
- [ ] 100% unauthorized tool calls blocked

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W5-MON — Monday, 16/11/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [ ] **W5-MON-01 · P1** — **Task:** Inspect synthetic mock Jira service and 30 issue records.  \\

  **Expected / DoD:** Inventory projects, sprints, issue schema.    
  **Evidence:** `evidence/W5/jira-inventory.md`.
- [ ] **W5-MON-02 · P0** — **Task:** Study agents, function tools and authorization boundaries.  \\

  **Expected / DoD:** Explain when to prefer deterministic code.    
  **Evidence:** `notes/W5-learning.md`.
- [ ] **W5-MON-03 · P1** — **Task:** Define typed contracts for 3 Jira tools.  \\

  **Expected / DoD:** Input/output schemas specify project/sprint permissions.    
  **Evidence:** `app/tools/schemas.py`.

**End-of-day checkpoint (W5-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W5-TUE — Tuesday, 17/11/2026 · target 4h

- [ ] **W5-TUE-01 · P0** — **Task:** Implement get\_project\_info and get\_sprint\_issues.  \\

  **Expected / DoD:** Both tools use mock Jira read-only endpoints.    
  **Evidence:** `tool tests + traces`.
- [ ] **W5-TUE-02 · P1** — **Task:** Implement get\_issue\_details.  \\

  **Expected / DoD:** Valid IDs and unauthorized IDs behave safely.    
  **Evidence:** `tool tests`.
- [ ] **W5-TUE-03 · P0** — **Task:** Create shared authorization wrapper for tool execution.  \\

  **Expected / DoD:** Project permissions verified before fetch.    
  **Evidence:** `tests/test_jira_auth.py`.

**End-of-day checkpoint (W5-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W5-WED — Wednesday, 18/11/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W5-WED-01 · P0** — **Task:** Review agent tool catalog and threat model.  \\

  **Expected / DoD:** No write-capable Jira tools registered.    
  **Evidence:** `docs/W5-review.md`.
- [ ] **W5-WED-02 · P1** — **Task:** Connect LLM tool selection to strict schema validation.  \\

  **Expected / DoD:** Tools called with correct IDs or rejected.    
  **Evidence:** `agent trace examples`.
- [ ] **W5-WED-03 · P1** — **Task:** Implement deterministic overdue and blocked calculations in Python.  \\

  **Expected / DoD:** Computed metrics traceable to issue records.    
  **Evidence:** `tests/test_sprint_health.py`.

**End-of-day checkpoint (W5-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W5-THU — Thursday, 19/11/2026 · target 4h

- [ ] **W5-THU-01 · P0** — **Task:** Create/run 20-scenario tool selection evaluation.  \\

  **Expected / DoD:** ≥85% correct tool selection based on gold expectations.    
  **Evidence:** `evidence/W5/agent_eval.csv`.
- [ ] **W5-THU-02 · P1** — **Task:** Test fabricated issue, unknown sprint and unauthorized project.  \\

  **Expected / DoD:** Safe errors, no invented issue keys/statuses.    
  **Evidence:** `negative test report`.
- [ ] **W5-THU-03 · P1** — **Task:** Improve prompt/tool descriptions based on failure analysis.  \\

  **Expected / DoD:** Before/after metrics and reasoning captured.    
  **Evidence:** `evidence/W5/error-analysis.md`.

**End-of-day checkpoint (W5-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W5-FRI — Friday, 20/11/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W5-FRI-01 · P0** — **Task:** Run 3 tool tests, scenario eval and 100% auth denial checks.  \\

  **Expected / DoD:** Pass thresholds and block all unauthorized calls.    
  **Evidence:** `test logs + traces`.
- [ ] **W5-FRI-02 · P0** — **Task:** Open PR with agent, tool definitions and metrics.  \\

  **Expected / DoD:** Reviewable read-only architecture.    
  **Evidence:** `PR URL + commit`.
- [ ] **W5-FRI-03 · P0** — **Task:** Demo blockers and overdue issues with evidence.  \\

  **Expected / DoD:** Issue keys and owners trace to mock records.    
  **Evidence:** `demo + mentor notes`.

**End-of-day checkpoint (W5-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## W6 — Weekly Reporting &amp; PM Approval Workflow (23–27/11 2026)

**Goal:** F03 + F04 / GATE 3 — multi-step evidence-backed workflow.  **Expected deliverable:** Reviewable weekly draft and explicit PM approval; 10-case workflow eval.

**Week-level pass criteria (from deck):**

- [ ] At least 3 business steps in one run
- [ ] ≥90% success across 10 workflow cases
- [ ] 100% write/send operations server-gated on valid approval
- [ ] All 3 injected failure scenarios handled safely

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W6-MON — Monday, 23/11/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [ ] **W6-MON-01 · P1** — **Task:** Review W5 tool evidence and W4 RAG inputs.  \\

  **Expected / DoD:** Project sources and access assumptions verified.    
  **Evidence:** `handoff checklist`.
- [ ] **W6-MON-02 · P1** — **Task:** Study function calling and explicit workflow states.  \\

  **Expected / DoD:** Explain why prompt-only approval is inadequate.    
  **Evidence:** `notes/W6-learning.md`.
- [ ] **W6-MON-03 · P1** — **Task:** Design state machine draft → awaiting\_review → approved/rejected.  \\

  **Expected / DoD:** State transitions and PM identity persisted/auditable.    
  **Evidence:** `docs/W6-state-machine.md`.

**End-of-day checkpoint (W6-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W6-TUE — Tuesday, 24/11/2026 · target 4h

- [ ] **W6-TUE-01 · P0** — **Task:** Build evidence gathering from authorized RAG + mock Jira.  \\

  **Expected / DoD:** Each factual claim has reference to source.    
  **Evidence:** `app/workflows/evidence.py`.
- [ ] **W6-TUE-02 · P1** — **Task:** Generate editable report draft: progress, blockers, risks, next actions.  \\

  **Expected / DoD:** Traceable facts and unknowns separated.    
  **Evidence:** `app/workflows/report.py + sample draft`.
- [ ] **W6-TUE-03 · P1** — **Task:** Implement save/read draft and reviewer IDs.  \\

  **Expected / DoD:** Draft survives server restart (chosen DB).    
  **Evidence:** `DB tests`.

**End-of-day checkpoint (W6-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W6-WED — Wednesday, 25/11/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W6-WED-01 · P0** — **Task:** Review workflow safety, partial failures and approval contracts.  \\

  **Expected / DoD:** Server-side approval checks reviewed.    
  **Evidence:** `docs/W6-architecture-review.md`.
- [ ] **W6-WED-02 · P1** — **Task:** Implement PM review endpoints and audit trail.  \\

  **Expected / DoD:** Only authorized PM can approve/reject.    
  **Evidence:** `app/review.py + auth tests`.
- [ ] **W6-WED-03 · P1** — **Task:** Block send/write until server validates approved state.  \\

  **Expected / DoD:** Unauthorized or unapproved actions do not execute.    
  **Evidence:** `tests/test_approval.py`.

**End-of-day checkpoint (W6-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W6-THU — Thursday, 26/11/2026 · target 4h

- [ ] **W6-THU-01 · P0** — **Task:** Build/run 10 labelled workflow scenarios.  \\

  **Expected / DoD:** ≥90% successes; each step traceable.    
  **Evidence:** `evidence/W6/workflow_eval.csv`.
- [ ] **W6-THU-02 · P0** — **Task:** Inject 3 failures: e.g. Jira timeout, RAG outage, approval denied.  \\

  **Expected / DoD:** 3/3 fail safely without unauthorized send/write.    
  **Evidence:** `evidence/W6/failure-tests.md`.
- [ ] **W6-THU-03 · P1** — **Task:** Measure draft latency against ≤2-minute capstone goal.  \\

  **Expected / DoD:** Duration recorded on synthetic data.    
  **Evidence:** `performance log`.

**End-of-day checkpoint (W6-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W6-FRI — Friday, 27/11/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W6-FRI-01 · P0** — **Task:** Execute Gate 3 state, tool, auth and failure tests.  \\

  **Expected / DoD:** 3 steps; ≥90%; approval 100%; 3/3 failures.    
  **Evidence:** `test logs + traces`.
- [ ] **W6-FRI-02 · P0** — **Task:** Submit workflow diagram, demo and PR.  \\

  **Expected / DoD:** Approval rules reproducible and auditable.    
  **Evidence:** `PR + diagram + results`.
- [ ] **W6-FRI-03 · P0** — **Task:** Demo draft → PM review → approve/reject and Gate 3 assessment.  \\

  **Expected / DoD:** Mentor decision captured, no implied pass.    
  **Evidence:** `demo + scorecard`.

**End-of-day checkpoint (W6-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## W7 — Security, GenAIOps &amp; Staging Deployment (30/11–04/12 2026)

**Goal:** F01–F04 — release hardening.  **Expected deliverable:** Staging URL; CI pipeline; security tests; token/latency/tool traces.

**Week-level pass criteria (from deck):**

- [ ] Reproducible deployment from README + CI
- [ ] No critical security findings or leaked credentials
- [ ] Logs contain no secrets or sensitive payloads
- [ ] Functional and safety cases pass in CI

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W7-MON — Monday, 30/11/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [ ] **W7-MON-01 · P1** — **Task:** Audit MVP architecture, dependency and configuration baseline.  \\

  **Expected / DoD:** Release checklist + secrets inventory.    
  **Evidence:** `evidence/W7/release-readiness.md`.
- [ ] **W7-MON-02 · P1** — **Task:** Study OWASP LLM Top 10 and GenAIOps.  \\

  **Expected / DoD:** Select concrete threat and observability controls.    
  **Evidence:** `notes/W7-learning.md`.
- [ ] **W7-MON-03 · P1** — **Task:** Create Dockerfile + Compose for API/database.  \\

  **Expected / DoD:** Locally reproducible startup.    
  **Evidence:** `Docker files + README`.

**End-of-day checkpoint (W7-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W7-TUE — Tuesday, 01/12/2026 · target 4h

- [ ] **W7-TUE-01 · P0** — **Task:** Create CI lint, unit/integration and evaluation jobs.  \\

  **Expected / DoD:** PR pipeline runs automated checks.    
  **Evidence:** `CI config + run URL`.
- [ ] **W7-TUE-02 · P1** — **Task:** Configure isolated staging secrets and environment.  \\

  **Expected / DoD:** No secrets in Git/images/logs.    
  **Evidence:** `secrets checklist`.
- [ ] **W7-TUE-03 · P1** — **Task:** Deploy staging with documented rollback command.  \\

  **Expected / DoD:** Healthcheck reachable and revision recorded.    
  **Evidence:** `staging URL + deployment log`.

**End-of-day checkpoint (W7-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W7-WED — Wednesday, 02/12/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W7-WED-01 · P0** — **Task:** Security review: project scoping, prompt injection, malicious chunks, approval.  \\

  **Expected / DoD:** Threat matrix maps checks to blocking outcomes.    
  **Evidence:** `docs/W7-threat-model.md`.
- [ ] **W7-WED-02 · P1** — **Task:** Add observability for latency, tokens, estimated cost, tool events.  \\

  **Expected / DoD:** Traces useful but sensitive fields redacted.    
  **Evidence:** `sample redacted traces`.
- [ ] **W7-WED-03 · P0** — **Task:** Test timeout/retries and authorization negative paths.  \\

  **Expected / DoD:** Bounded retry and clear failures.    
  **Evidence:** `tests + incident observations`.

**End-of-day checkpoint (W7-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W7-THU — Thursday, 03/12/2026 · target 4h

- [ ] **W7-THU-01 · P0** — **Task:** Execute full safety regression: leaks, injections, writes, secrets.  \\

  **Expected / DoD:** No critical findings; failures triaged.    
  **Evidence:** `evidence/W7/security.md`.
- [ ] **W7-THU-02 · P1** — **Task:** Run end-to-end smoke tests in staging.  \\

  **Expected / DoD:** F01–F04 critical flows verified.    
  **Evidence:** `staging test report`.
- [ ] **W7-THU-03 · P1** — **Task:** Validate CI reproducibility and measure operating costs.  \\

  **Expected / DoD:** Pipeline evidence + cost assumptions recorded.    
  **Evidence:** `CI URL + cost notes`.

**End-of-day checkpoint (W7-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W7-FRI — Friday, 04/12/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W7-FRI-01 · P0** — **Task:** Release-gate regression, test logs and redaction review.  \\

  **Expected / DoD:** CI green; no critical blockers.    
  **Evidence:** `CI + security/eval evidence`.
- [ ] **W7-FRI-02 · P0** — **Task:** Submit staging URL, pipeline, traces and README in PR.  \\

  **Expected / DoD:** Mentor can reproduce deployment.    
  **Evidence:** `PR + release SHA + URL`.
- [ ] **W7-FRI-03 · P0** — **Task:** Demo safe failure and staging flows.  \\

  **Expected / DoD:** Review outcome and follow-ups recorded.    
  **Evidence:** `demo + review notes`.

**End-of-day checkpoint (W7-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## W8 — Integrated Delivery Assistant &amp; Individual Challenge (07–11/12 2026)

**Goal:** F01–F04 / FINAL GATE.  **Expected deliverable:** Integrated staging MVP; three business demos; independent technical challenge.

**Week-level pass criteria (from deck):**

- [ ] Three required business scenarios demo successfully
- [ ] Individual score ≥70/100 and all four gates passed
- [ ] Staging, CI/evaluation evidence, tracing and docs available
- [ ] No blocking security or approval failure

**Daily tasks** — each is an actionable checkpoint; check only after evidence exists. **Allocation:** Monday 30+45+165 = 240 minutes (where 3 tasks); Tuesday/Wednesday/Thursday 45+150+45 = 240; Friday 120+90+30 = 240. For W2 Monday (four tasks): 30+40+105+65 = 240. The durations are planning approximations, not deck requirements.

### W8-MON — Monday, 07/12/2026 · target 4h

**Cadence:** week objectives, assignment scope, carryover, setup.

- [ ] **W8-MON-01 · P1** — **Task:** Freeze candidate architecture/release scope and review unresolved defects.  \\

  **Expected / DoD:** Release/feature freeze decisions recorded.    
  **Evidence:** `release candidate notes`.
- [ ] **W8-MON-02 · P1** — **Task:** Study evaluation best practices and reproducibility.  \\

  **Expected / DoD:** Document failure taxonomy and limitations.    
  **Evidence:** `notes/W8-learning.md`.
- [ ] **W8-MON-03 · P1** — **Task:** Capture model/prompt versions, dataset IDs and target staging URL.  \\

  **Expected / DoD:** End-to-end version manifest created.    
  **Evidence:** `evidence/W8/release-manifest.md`.

**End-of-day checkpoint (W8-MON):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W8-TUE — Tuesday, 08/12/2026 · target 4h

- [ ] **W8-TUE-01 · P0** — **Task:** Integration test F01 cited project Q&amp;A incl. abstention.  \\

  **Expected / DoD:** Citations inspectable, access enforced.    
  **Evidence:** `F01 demo script + test results`.
- [ ] **W8-TUE-02 · P1** — **Task:** Integration test F02 sprint health analysis.  \\

  **Expected / DoD:** Issue facts trace to read-only Jira.    
  **Evidence:** `F02 demo script + traces`.
- [ ] **W8-TUE-03 · P0** — **Task:** Integration test F03+F04 draft and approval.  \\

  **Expected / DoD:** Editable draft, PM consent, audit trail.    
  **Evidence:** `F03/F04 demo script`.

**End-of-day checkpoint (W8-TUE):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W8-WED — Wednesday, 09/12/2026 · target 4h

**Cadence:** architecture/code review; unblock integration and security risks.

- [ ] **W8-WED-01 · P0** — **Task:** Architecture review of security, evaluation, cost and failure modes.  \\

  **Expected / DoD:** Design decisions defensible in technical Q&amp;A.    
  **Evidence:** `docs/architecture.md`.
- [ ] **W8-WED-02 · P0** — **Task:** Execute full API/retrieval/agent/approval/safety regressions.  \\

  **Expected / DoD:** No blocker failures; known limitations documented.    
  **Evidence:** `final QA matrix`.
- [ ] **W8-WED-03 · P1** — **Task:** Dry run team demo and improve reproducibility.  \\

  **Expected / DoD:** All 3 scenarios fit agreed demo plan.    
  **Evidence:** `demo timing notes`.

**End-of-day checkpoint (W8-WED):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W8-THU — Thursday, 10/12/2026 · target 4h

- [ ] **W8-THU-01 · P0** — **Task:** Prepare final PR, runbook and deployment instructions.  \\

  **Expected / DoD:** Fresh reviewer can execute all 3 flows.    
  **Evidence:** `README/runbook + PR`.
- [ ] **W8-THU-02 · P1** — **Task:** Compile reproducible results: scores, citations, traces, CI, cost.  \\

  **Expected / DoD:** All artifacts tied to release SHA.    
  **Evidence:** `evidence/W8/final-evidence-index.md`.
- [ ] **W8-THU-03 · P1** — **Task:** Practice individual unseen-style task and technical defense.  \\

  **Expected / DoD:** Able to explain own code and trade-offs.    
  **Evidence:** `preparation notes`.

**End-of-day checkpoint (W8-THU):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

### W8-FRI — Friday, 11/12/2026 · target 4h

**Cadence:** tests/evaluation + PR/evidence + demo/mentor review. Gate decision requires real validation.

- [ ] **W8-FRI-01 · P0** — **Task:** Run three business demos: knowledge, sprint analysis, reporting/approval.  \\

  **Expected / DoD:** All three completed with business evidence.    
  **Evidence:** `demo video + logs`.
- [ ] **W8-FRI-02 · P0** — **Task:** Complete individual technical challenge and mentor review.  \\

  **Expected / DoD:** Individual ownership verified; score recorded.    
  **Evidence:** `challenge result + scorecard`.
- [ ] **W8-FRI-03 · P0** — **Task:** Close final gate checklist and archive artifacts.  \\

  **Expected / DoD:** Weighted score ≥70, Gate 1/2/3/Final all Pass, no safety blockers.    
  **Evidence:** `final scorecard + signed decision`.

**End-of-day checkpoint (W8-FRI):** status per task, actual hours, test counts/metrics, evidence links, blockers/owner, next action; see [Daily report template](#daily-report-template-copy-each-day).

**Friday submission bundle:** PR/branch + SHA + README run commands + dependency versions; passing and failing test results; labelled eval dataset/version/metrics; security checks and redacted traces; demo/screenshots; learning/trade-offs; mentor score/action items. Gate status only after reviewer confirmation.

## Evaluation definitions and reporting


| Week | Metric                     | How to record                                                                     | Threshold                |
| ---- | -------------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| W1   | Category accuracy          | Correct category / 20 labelled issues                                             | ≥85%                     |
| W1   | Critical P1 recall         | Critical incidents correctly marked P1 / all critical incidents                   | 100%                     |
| W1   | Structured output validity | Valid responses among successful outputs                                          | 100%                     |
| W2   | Extraction accuracy        | Correct fact/action extraction using published gold/rubric / 20 cases             | ≥85%                     |
| W2   | Failure scenarios          | Valid invalid-payload, timeout, 429, upstream 500, malformed model output         | 5/5                      |
| W3   | Recall@5                   | Number of queries where an expected relevant document/chunk appears in top 5 / 20 | ≥80%                     |
| W4   | Q&amp;A correctness        | Correct answers / 30 fixed Q&amp;A cases                                          | ≥85%                     |
| W4   | Citation support           | Claims with supporting cited passages / audited cited claims                      | ≥90%                     |
| W5   | Tool selection accuracy    | Correct tool choice/arguments / 20 labelled scenarios                             | ≥85%                     |
| W5   | Authorization              | Unauthorized tool calls blocked / unauthorized calls tested                       | 100%                     |
| W6   | Workflow success           | Successful end-to-end cases / 10                                                  | ≥90%                     |
| W6   | Approval                   | Write/send actions rejected without server-validated approval                     | 100%                     |
| W6   | Injected failures          | Safely handled injected failure cases                                             | 3/3                      |
| W8   | Final readiness            | Weighted assignment score + four gates + individual ownership                     | ≥70/100 + all gates PASS |


> Evaluation rubric details for extraction matching and citation claim counting should be agreed with the mentor and fixed **before** scoring. Do not treat response fluency or model-generated gold labels as evidence.

### Scoring and mandatory gates

- Weekly rubric: functional correctness **35**, AI quality &amp; evaluation **25**, engineering quality **15**, security &amp; reliability **15**, technical explanation **10** (100 total).
- Weighted weekly contribution: W1 **5%**, W2 **10%**, W3 **10%**, W4 **15%**, W5 **15%**, W6 **15%**, W7 **10%**, W8 **20%**.
- Final categories: **85+ Strong candidate**, **70–84 Project-ready**, **50–69 Developing**, **&lt;50 Not ready**. Readiness also requires weighted score ≥70, all four gates PASS, verified individual work and no critical security failures.
- Mentor should retain **20–30% hidden evaluation cases** separately. Public starter-kit examples are not final gate answers.

### Negative / security scenarios (blocking across weeks)

- [ ] Unanswerable project question → explicit no-answer (never invent missing facts).
- [ ] Cross-project request → no unauthorized content **or citations**.
- [ ] Prompt injection inside retrieved text → treated only as untrusted content.
- [ ] Request to update Jira / send report → denied without appropriate permission and verified PM approval.
- [ ] Jira/LLM timeout or 429 → bounded retry, safe status and no accidental action.
- [ ] Conflicting plan versions → state discrepancy and cite both supporting sources.
- [ ] Secrets in Git, logs or trace payloads → no exposures.

## Daily report template (copy each day)

```markdown
### Daily AI Engineering Report — YYYY-MM-DD
- Week / day: Wn-DAY
- Target hours / actual hours: 4 / __
- Focus / goal:
- Completed:
  - TASK-ID — status DONE — outcome — commit/test/evidence link
- In progress:
  - TASK-ID — remaining scope / estimated effort
- Blocked:
  - TASK-ID — blocker — owner — proposed unblocking action
- Tests / eval: __ passed, __ failed; dataset __; model/prompt version __; metrics __
- Evidence: PR __ | SHA __ | eval CSV __ | logs __ | demo __
- Carryover (never assume PASS): __
- Architecture decisions / trade-offs: __
- Next workday top 3: __
- Mentor review (if Friday): status __ / score __ / action items __
```

## Friday PR &amp; demo template

```markdown
## Week Wn — <deliverable>
### Scope / acceptance
- [ ] Required function(s) demonstrably work
- [ ] Metric thresholds met with pinned labelled dataset
- [ ] Negative/security checks pass
### Run / reproduce
- Branch / commit SHA:
- Environment and dependency versions:
- Setup / API / eval / test commands:
### Evidence
- Test result URL/log:
- Evaluation CSV + metric summary:
- Redacted traces/screenshots:
- Demo recording or 5–10-minute demo script:
### Honest status
- Known failures / limitations:
- Improvement plan / owner / date:
- Mentor score + Gate PASS/FAIL/PENDING (mentor only):
```

## GitHub workflow suggestion

For each day, create a GitHub Issue with the day heading and its task IDs; use labels `week:W2`, `kind:learning|build|eval|security|evidence`, `status:blocked` as helpful. Reference task IDs in commits/PR descriptions. Suggested branches `feature/w2-meeting-notes-api`, `feature/w3-project-search`, etc. Keep all real secrets in the environment or approved secret store, never commit `.env`.

**Scope note:** This document is ready to commit as a working plan, but the starter-kit source code, fixtures, repo URLs, API keys, mentor hidden test suite and approval status have not been inspected. Validate these before running commands or claiming evidence.