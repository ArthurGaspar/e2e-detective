# Data format

The case archive is plain JSON plus JPEG screenshots. The same layout is used by local runs (`.runs-data/`), the public `runs-data` branch, the dashboard's bundled sample (`dashboard/public/sample/`), and the static export of the MongoDB adapter. The TypeScript types in `agent/src/store.ts` are the source of truth. This page explains them.

## Layout

```
<data>/
├── index.json            # summaries the dashboard loads first
├── model.json            # optional: model retrained by `patrol --retrain`
├── cases/
│   ├── <caseId>.json     # CaseDoc
│   └── <caseId>.jpg      # masked failure screenshot, when one was captured
└── runs/
    └── <runId>.json      # RunDoc
```

The `runs-data` branch also has a root `.gitattributes`. `check:publication` reads it as text (and still scans it). Any other file type must be allowed in `agent/src/check-publication.ts`, or the patrol job fails.

## Identifiers

- **Run id:** `<UTC timestamp, compact>-<seed in base 36>`, for example `20261026T201535Z-26ah13`. The seed lets you replay the fault plan with `npm run patrol -- --seed <seed>`, where `<seed>` is the base-36 suffix converted to decimal.
- **Case id:** `<runId>-<n>`, where `n` counts failures within the run from 1.

Ids sort chronologically as strings, and retention relies on this.

## `RunDoc` (`runs/<runId>.json`)

| Field | Meaning |
|---|---|
| `_id`, `startedAt`, `finishedAt` | Run identity and ISO timestamps |
| `target` | Crime scene URL, passed through `redactUrl` |
| `trigger` | `schedule`, `workflow_run`, `workflow_dispatch`, `manual`, `sweep`… |
| `tests[]` | One per test: `key`, `title`, `outcome` (`expected` / `unexpected` / `flaky`), `durationMs`, `scenario`, `cause` (ground truth), `caseId` when a case was opened |

A case is opened for every test that had a failed attempt, including `flaky` tests that passed on retry.

## `CaseDoc` (`cases/<caseId>.json`)

| Field | Meaning |
|---|---|
| `_id`, `runId`, `openedAt` | Identity |
| `test` | `{ key, title, file }`. `file` is relative to `tests/`, which `heal` uses to find the spec |
| `outcome` | Playwright outcome for the test |
| `attempts[]` | Per retry: `retry`, `status`, `durationMs`, redacted `error`, failing `locator` (or `null`), `api` (calls whose URL contains `/api/`), `consoleErrors` |
| `snapshot` | Redacted ARIA snapshot from the last attempt (≤ 4000 chars) |
| `screenshot` | `cases/<caseId>.jpg`, or `null` |
| `features` | The feature vector at the time the case was opened (recomputed from evidence for training) |
| `suspects` | Per-cause model scores. Without a model, it is 1 for the rules verdict and 0 for the others |
| `verdict` | `{ cause, confidence, by: "model" \| "rules" }` |
| `rulesVerdict` | Deterministic baseline, always stored |
| `healLeads[]` | `{ locator, score, candidate }`, best first |
| `truth` | `{ scenario, cause }`: **what was actually injected. Never an input to features, the model or LLM prompts** |
| `report?` | Optional `CaseReport` from `investigate` (see below) |

### `NetworkCall`

`{ url, status, ms, failure? }`. URLs have no credentials, query string or fragment. `status` is `0` when there was no response. A `0` with `failure` set means a network error (`requests_failed`). A `0` without `failure` means the request was still pending when the test stopped (`requests_pending`).

### `CaseReport`

`model`, `writtenAt`, `verdict`, `confidence` (self-reported by the LLM), `summary`, `clues[]`, `nextStep`, optional `fixedLocator` (for `outdated_test`) and optional `issueDraft: { title, body }` (agent mode only, never published automatically).

## `index.json`

```ts
{
  updatedAt: string;
  cases: { _id, runId, openedAt, test /* title */, verdict, confidence, truth, reported, healable }[];
  runs:  { _id, startedAt, trigger, passed, failed, flaky }[];
}
```

`cases[].verdict` and `confidence` come from the LLM report when there is one, otherwise from the classifier. `truth` is the injected cause, used by the dashboard's **Wrong diagnoses** filter. Both lists are newest first and capped at 400 cases / 300 runs.

## Training records (`model/training.jsonl`)

One JSON object per line:

```json
{"id": "<caseId>", "cause": "outdated_test", "input": { "outcome": "...", "attempts": [...], "snapshot": "...", "healLead": {...} }}
```

`input` is a `FeatureInput` (see `agent/src/features.ts`). Only raw evidence is stored and features are computed on read, so the file stays valid when features change. Records with the same `id` as a labeled case in the store are deduplicated.

## Changing a shape

The archive is read by code in three places with different release cycles: the agent, the deployed dashboard, and the frozen sample archive. History on `runs-data` keeps older documents until retention removes them. When changing `CaseDoc`, `RunDoc` or `Index`:

- add fields as optional, or handle their absence in `dashboard/src`;
- update `dashboard/public/sample/` if the dashboard depends on the new field;
- keep `inputFromCase` able to build a `FeatureInput` from older cases.
