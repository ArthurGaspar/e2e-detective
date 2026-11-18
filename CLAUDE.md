# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node.js 22+. Root and `dashboard/` are separate npm packages with their own lockfiles.

```sh
npm ci && npx playwright install chromium   # root (agent, tests)
npm --prefix dashboard ci                   # dashboard

npm test                                    # vitest, agent/test/**/*.test.ts only
npx vitest run agent/test/redact.test.ts    # single test file
npx vitest run -t "accepts redacted"        # single test by name
npm run typecheck                           # tsc over agent/, tests/, examples/external/
npm run test:e2e                            # Playwright journeys vs. clean crime scene (auto-starts :4400)
npx playwright test tests/sign-in.spec.ts   # single journey
npm run test:dashboard                      # dashboard browser checks (auto-starts Vite on :5173)
npm --prefix dashboard run build            # dashboard typecheck + build (separate tsconfig)
npm --prefix dashboard run dev              # dashboard + /crime-scene/ + /data/ (.runs-data) + model.json
npm run scene                               # serve crime-scene/ alone on :4400
```

Agent CLI (all via `tsx agent/src/cli.ts`; see header of `cli.ts`): `patrol`, `sweep`, `train`, `evaluate`, `investigate [--agent]`, `generate <journey.md>`, `heal <caseId>`, `analyze-trace <zip>`. Common flags: `--data` (default `.runs-data`), `--seed`, `--scenario <id>`, `--target <url>`. `investigate`/`generate`/`heal` need local Ollama (`OLLAMA_MODEL`, `OLLAMA_URL`). `npm run check:publication -- <dir>` needs `tesseract` on PATH for images.

What CI runs before deploy (`.github/workflows/deploy.yml`): `npm test`, `npm run typecheck`, dashboard build, `test:dashboard`, then `check:publication` on `dashboard/dist`.

## Architecture

Detailed docs: `docs/architecture.md`, `docs/data-format.md` (archive JSON shapes), `docs/extending.md` (checklists for adding faults, journeys, features, artifact types). Keep them in sync when changing those areas.

The project is a lab: inject a known fault into Playwright runs, collect observable evidence when a test fails, classify the cause, and compare against the hidden ground truth.

**Pipeline (`agent/src/patrol.ts`)**
1. Lists tests via `playwright --list`, draws a scenario per test from `scenarios.ts` (seeded mulberry32 PRNG, so `--seed` reproduces a plan), and passes the plan to Playwright as the `CHAOS_PLAN` env var keyed by `testKey(file, title)` = `"file.spec.ts > title"`.
2. `tests/fixtures.ts` is an auto fixture every spec must import (`import { test, expect } from "../fixtures"`). It applies the scenario — either a crime-scene `release` (set into `sessionStorage` via init script) or a network fault via `page.route("**/api/**")` — and, on failure, attaches a masked screenshot and a redacted `forensics` JSON (ARIA snapshot, interactive candidates, network, console errors).
3. Playwright writes a JSON report to a temp `.patrol/<runId>/` dir (deleted afterwards); `evidence.ts` turns it into `TestEvidence`.
4. `features.ts` computes the 17-feature vector, `model.ts` predicts with logistic regression (falls back to `rulesVerdict` if no `model/model.json`), `heal.ts` ranks locator replacements.
5. A `CaseDoc` per failure and one `RunDoc` are saved via `store.ts`.

**Ground truth isolation is the core invariant.** `CaseDoc.truth` (injected scenario/cause) must never feed `features.ts`, the model, or LLM prompts. It is used only for training labels and scoring.

**Feature/model coupling.** `FEATURES` in `features.ts` is positional; `model/model.json` stores weights, mean and std in that order. Adding, removing or reordering a feature requires `npm run train` to regenerate `model.json`. Training samples store raw `FeatureInput` (in `model/training.jsonl` and in cases), and features are recomputed on read, so old data stays usable after feature changes. `evaluate` reproduces README metrics without rewriting the model.

**Crime scene (`crime-scene/`)** is a static vanilla-JS app backed by `api/*.json`. Writes live in `sessionStorage`. Buggy builds are selected by the `release` switch (`stable`, `redesign`, `bug-accuse`, `bug-evidence`, `bug-close`); adding a fault means adding a release branch in `app.js` and a `Scenario` in `scenarios.ts`. Demo login: `221B` / `elementary`.

**Journeys → tests.** `journeys/*.md` are plain-language inputs; `generate` has Ollama record `tests/generated/*.spec.ts`, verifying each step against the live page. `tests/sign-in.spec.ts` is hand-written.

**Storage (`store.ts`, `mongo-store.ts`).** `createStore` picks MongoDB when `MONGODB_URI` is set, otherwise JSON in `--data`: `cases/<id>.json` (+ `cases/<id>.jpg` screenshot), `runs/<id>.json`, `index.json` summaries. Rebuilding the index enforces retention (`KEEP_CASES = 400`, `KEEP_RUNS = 300`). The Mongo store also exports this same JSON layout, because the dashboard only reads static files.

**Dashboard (`dashboard/`)** is React + Vite and imports types directly from `agent/src` (`CaseDoc`, `Index`, `Model`). `data.ts` loads `${VITE_DATA_URL}index.json` and falls back to the bundled `public/sample/` archive. In production `VITE_DATA_URL` points to the raw `runs-data` branch. In dev, `vite.config.ts` serves `/data/` from `../.runs-data` (override with `CASE_DATA_DIR`), `/crime-scene/` and `/model.json`. Changing `CaseDoc`/`Index` shapes affects the dashboard, the sample archive and the published `runs-data` history.

**Deployment.** `deploy.yml` builds the dashboard, copies `crime-scene/` into `dist/crime-scene/` and publishes to GitHub Pages. `patrol.yml` (every 3 h and after each successful deploy) runs `patrol --retrain` against the deployed crime scene, runs `check:publication` on the `runs-data` worktree, and commits to the orphan `runs-data` branch.

**External trace analysis (`analyze-trace.ts`)** is independent of the lab. It reads any Playwright `trace.zip` in memory (fflate) and emits JSON/Markdown/SARIF. It deliberately does not use the lab classifier. Regression fixtures are in `agent/test/fixtures/external/`; `examples/external/` regenerates them against public TodoMVC (`npm run proof:external`).

## Privacy / LGPD constraints

Everything a patrol produces is published publicly, so privacy is a CI gate, not a convention:
- Playwright traces and automatic screenshots are intentionally `off` in `playwright.config.ts`. Screenshots come only from `captureMaskedScreenshot` (`screenshot.ts`). Mark rendered personal data in the crime scene with `data-private`.
- Network evidence is metadata only (no bodies/headers). URLs go through `redactUrl` (strips credentials, query, fragment). Free text goes through `redactText` (emails, check-digit-valid CPFs).
- `check-publication.ts` fails CI for unredacted data, OCR hits, unreadable files, or **any file type outside its allowlist**. New artifact types written to the archive or `dashboard/dist` must be added there, or CI will fail. Its messages are in Portuguese and never print the matched value.
