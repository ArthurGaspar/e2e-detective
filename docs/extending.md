# Extending the lab

Checklists for the common changes. Each lists every place that has to change together. For how the pieces fit, see [architecture.md](architecture.md).

## Add a fault scenario

**A buggy app release** (`real_bug` or `outdated_test`):

1. `crime-scene/app.js`: add the name to `RELEASES`, document it in the header comment, and branch on `release === "<name>"` where the behavior should differ.
2. `agent/src/scenarios.ts`: add `{ id, cause, release: "<name>", weight }` to `SCENARIOS`.
3. Check it by hand: `npm run patrol -- --scenario <id>` should open cases, and `npm run test:e2e` (clean) should still pass. You can also open `http://localhost:4400/?release=<name>` after `npm run scene`.

**A network fault** (`flaky` or `environment`):

1. `agent/src/scenarios.ts`: extend the `network` union and add the scenario.
2. `tests/fixtures.ts`: handle the new value inside the `page.route("**/api/**")` handler.

Both kinds:

- Keep the fault's own fingerprints out of the evidence. If the harness leaves a marker the real-world failure would not have, `evidence.ts` must ignore it (see the `_wasFulfilled` note there).
- Weights are relative. Changing them changes the class balance of future patrols and sweeps.
- To make the model learn the new fault, collect labeled data (`npm run sweep -- --runs 10 --faults-only`) and run `npm run train`. Update the README's results section if the numbers change.

## Add a journey test

1. Describe the journey in `journeys/<name>.md`: plain language, including credentials and the expected final state.
2. Record it: `npm run generate -- journeys/<name>.md` (needs Ollama). The spec lands in `tests/generated/<name>.spec.ts`. Review its assertions, because passing the recorder's checks does not prove they match the journey's intent.
3. Hand-written specs go in `tests/`. `tests/sign-in.spec.ts` is the reference the recorder shows the LLM as the style to follow, so keep it idiomatic. All specs **must** `import { test, expect } from "../fixtures"` (or `"./fixtures"`). Otherwise faults are never applied and forensics are never collected.
4. Run `npm run test:e2e`. It must pass against the clean crime scene.

Test titles and file names form the `testKey` used in fault plans and case `test.key`. Renaming a test makes it a different test in history.

## Add or change a feature

1. `agent/src/features.ts`: add the name to `FEATURES` and compute it in `extractFeatures`, using only `FeatureInput` and never `truth`. If the feature needs evidence that isn't in `FeatureInput` yet, add it there, in `inputFromEvidence`, in `inputFromCase` (`store.ts`), and in the forensics the fixture collects. Older records will lack it, so default sensibly.
2. `dashboard/src/data.ts`: add a human label to `FEATURE_LABEL`.
3. Optional: use it in `rulesVerdict` (`model.ts`) or in the LLM brief (`investigate.ts` `keyClues`).
4. Run `npm run train`. `model/model.json` stores weights by position, so the committed model is invalid until it is regenerated.
5. Run `npm test` and `npm run evaluate -- --seed 1`, and update the README's metrics and feature count if they change.

Features are recomputed from stored evidence on read, so `model/training.jsonl` and archived cases don't need migrating.

## Publish a new artifact type

Anything written into the case archive or `dashboard/dist` is checked by `agent/src/check-publication.ts` before it is published. The checker:

- allows only `.css .html .js .json .md .svg .txt` (scanned as text), `.jpeg .jpg .png` (scanned with Tesseract OCR), plus `.gitattributes` / `.gitignore` as text;
- fails on any other extension, on unreadable or malformed files, and on filenames that look like personal data;
- in JSON, flags populated personal-looking keys (`email`, `telefone`, `nomeCompleto`…) unless the value is masked (`[REDACTED]`, `[EMAIL]`, `***`…).

To publish a new kind of file, add its extension and a matching scan to the checker, and add a test in `agent/test/check-publication.test.ts`. To show new personal-looking data in the crime scene, mark it `data-private` so screenshots mask it. Run the check locally with Tesseract on the PATH:

```sh
npm run check:publication -- .runs-data
npm run check:publication -- dashboard/dist
```

## Change the storage backend

Implement `Store` from `agent/src/store.ts` and select it in `createStore`. `rebuildIndex` must enforce `KEEP_CASES` / `KEEP_RUNS` and leave the static [data layout](data-format.md) in `--data`, because the dashboard only reads static files. `mongo-store.ts` shows the pattern: the database is authoritative, and it exports through a `JsonStore` after `clearArchive()`. Load optional drivers with a dynamic `import()` so JSON-only installs keep working.
