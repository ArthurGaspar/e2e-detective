/**
 * e2e-detective command line.
 *
 *   patrol       run all tests once with hidden faults and open cases for failures
 *   sweep        run many patrols to build a labeled training set
 *   train        retrain the classifier and report cross-validated accuracy
 *   investigate  write LLM reports for cases that don't have one (needs Ollama)
 *   generate     record a Playwright test from a plain-language journey (needs Ollama)
 *   heal         rewrite a broken locator in a spec using a case's best lead
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { generate } from "./generate";
import { applyHeal } from "./heal";
import { interrogate } from "./investigate";
import { Ollama } from "./llm";
import { evaluate, train, type Model, type Sample } from "./model";
import { MODEL_PATH, ROOT, loadModel, patrol } from "./patrol";
import { extractFeatures, type FeatureInput } from "./features";
import { JsonStore, inputFromCase, type CaseDoc } from "./store";

const TRAINING_PATH = join(ROOT, "model/training.jsonl");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: "string", default: ".runs-data" },
    seed: { type: "string" },
    target: { type: "string" },
    trigger: { type: "string", default: "manual" },
    scenario: { type: "string" },
    runs: { type: "string", default: "10" },
    limit: { type: "string", default: "20" },
    retrain: { type: "boolean", default: false },
    "faults-only": { type: "boolean", default: false },
    model: { type: "string" },
  },
});

const [command, ...args] = positionals;
const store = () => new JsonStore(resolve(ROOT, values.data!));
const seed = () => (values.seed ? Number(values.seed) : Math.floor(Math.random() * 2 ** 31));

/** One line per labeled failure: its evidence and its injected cause. Features are computed on read. */
interface TrainingRecord {
  cause: Sample["cause"];
  input: FeatureInput;
}

function readTraining(): Sample[] {
  if (!existsSync(TRAINING_PATH)) return [];
  return readFileSync(TRAINING_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TrainingRecord)
    .filter((r) => r.input)
    .map((r) => ({ cause: r.cause, features: extractFeatures(r.input) }));
}

const record = (c: CaseDoc): TrainingRecord | null => (c.truth.cause ? { cause: c.truth.cause, input: inputFromCase(c) } : null);
const labeled = (c: CaseDoc): Sample | null => {
  const r = record(c);
  return r ? { cause: r.cause, features: extractFeatures(r.input) } : null;
};

/**
 * Retrains on the bundled training set plus every labeled case in the store and
 * saves the result next to the cases, so the published model improves with each
 * patrol. Falls back to the bundled model while there is too little data.
 */
async function retrain(s: JsonStore): Promise<Model | null> {
  const samples = [...readTraining(), ...(await s.listCases()).map(labeled).filter((x): x is Sample => x !== null)];
  if (samples.length < 20) return loadModel();
  const model: Model = { ...train(samples), metrics: evaluate(samples) };
  writeFileSync(join(resolve(ROOT, values.data!), "model.json"), JSON.stringify(model));
  return model;
}

async function main() {
  switch (command) {
    case "patrol": {
      const s = store();
      const model = values.retrain ? await retrain(s) : loadModel();
      const { run, cases } = await patrol({ store: s, model, seed: seed(), trigger: values.trigger!, target: values.target, scenario: values.scenario });
      await s.rebuildIndex();
      console.log(`Run ${run._id}: ${run.tests.length} tests, ${cases.length} case(s) opened.`);
      for (const c of cases) console.log(`  ${c._id}  ${c.test.title}  -> ${c.verdict.cause} (${Math.round(c.verdict.confidence * 100)}%)  [injected: ${c.truth.scenario}]`);
      break;
    }
    case "sweep": {
      const runs = Number(values.runs);
      const s = new JsonStore(resolve(ROOT, ".sweep-data"));
      let added = 0;
      for (let i = 0; i < runs; i++) {
        const { cases } = await patrol({ store: s, model: null, seed: seed(), trigger: "sweep", target: values.target, faultsOnly: values["faults-only"] });
        for (const c of cases) {
          const r = record(c);
          if (r) {
            appendFileSync(TRAINING_PATH, JSON.stringify(r) + "\n");
            added++;
          }
        }
        console.log(`sweep ${i + 1}/${runs}: ${cases.length} case(s)`);
      }
      console.log(`Added ${added} labeled samples to ${TRAINING_PATH}.`);
      break;
    }
    case "train": {
      const fromStore = existsSync(resolve(ROOT, values.data!)) ? (await store().listCases()).map(labeled).filter((x): x is Sample => x !== null) : [];
      const samples = [...readTraining(), ...fromStore];
      if (samples.length < 20) throw new Error(`Only ${samples.length} labeled samples; run \`npm run sweep\` first.`);
      const metrics = evaluate(samples);
      const model = { ...train(samples), metrics };
      writeFileSync(MODEL_PATH, JSON.stringify(model, null, 1));
      const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
      console.log(`Trained on ${samples.length} samples. Cross-validated accuracy ${pct(metrics.accuracy)} (rules ${pct(metrics.rulesAccuracy)}, majority ${pct(metrics.majorityAccuracy)}).`);
      break;
    }
    case "investigate": {
      const s = store();
      const llm = new Ollama(values.model);
      const open = (await s.listCases()).filter((c) => !c.report).sort((a, b) => b._id.localeCompare(a._id)).slice(0, Number(values.limit));
      if (!open.length) console.log("Every case already has a report.");
      for (const c of open) {
        process.stdout.write(`Interrogating ${c._id} (${c.test.title})… `);
        try {
          c.report = await interrogate(llm, c);
          await s.saveCase(c, null);
          const truth = c.truth.cause ?? "unknown";
          console.log(`${c.report.verdict} (${Math.round(c.report.confidence * 100)}%), injected cause: ${truth}`);
        } catch (err) {
          console.log(`failed: ${(err as Error).message}`);
        }
      }
      await llm.unload();
      await s.rebuildIndex();
      break;
    }
    case "generate": {
      if (!args.length) throw new Error("Usage: npm run generate -- journeys/<name>.md [...]");
      const llm = new Ollama(values.model);
      for (const journey of args) {
        console.log(`Recording ${journey} with ${llm.model}`);
        const r = await generate(llm, resolve(ROOT, journey));
        console.log(r.ok ? `  -> ${r.file} (${r.steps} steps, ${r.rejected} rejected tries)` : `  -> failed: ${r.reason}`);
      }
      break;
    }
    case "heal": {
      const id = args[0];
      if (!id) throw new Error("Usage: npm run heal -- <caseId>");
      const c = await store().getCase(id);
      if (!c) throw new Error(`No case ${id} in ${values.data}`);
      const broken = c.attempts[c.attempts.length - 1].locator;
      const replacement = c.report?.fixedLocator ?? c.healLeads[0]?.locator;
      if (!broken || !replacement) throw new Error("This case has no broken locator or no replacement to suggest.");
      const specPath = join(ROOT, "tests", c.test.file);
      const src = readFileSync(specPath, "utf8");
      const healed = applyHeal(src, broken, replacement);
      if (!healed) throw new Error(`Couldn't find ${broken} in ${c.test.file}; edit it by hand.`);
      writeFileSync(specPath, healed);
      console.log(`Replaced ${broken}\n    with ${replacement}\nin tests/${c.test.file}. Review the diff, then run the test.`);
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
