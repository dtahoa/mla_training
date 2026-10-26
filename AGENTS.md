# mla_training Constitution

The human-readable contract for anyone — person or agent — working in this
repo. This file is AUTHORITATIVE: where it and `.agents/orchestration.yaml`
disagree, this wins.

`og init` wrote this stub. Fill it in; the orchestrator reads it before
planning, and an empty section means it will ask you instead of guessing.

## Trigger Phrases

Short phrases that mean a specific workflow rather than a literal request.
Delete this table if you have none.

| Phrase | Action |
|--------|--------|
| _e.g. "new alignment"_ | _what should happen_ |

## Core Principles

What matters in this codebase and why. Be specific — "write tests" is not
actionable; "every handler needs an integration test that exercises the real
database" is.

## Development Workflow

### Branching

Detected: integration base `TODO`, task branches `feature/<slug>`.
Protected: none detected.

### Before a PR

What must be true before review. The machine-checkable parts belong in
`.agents/orchestration.yaml` under `gates`; describe the judgement calls here.

## File Placement Rules

Where new code goes, and what must not be touched.

## Human Checkpoints

What an agent must stop and ask about rather than decide. Anything
irreversible, anything that claims something about reality (a status, a
release), and anything touching money or customer data.
