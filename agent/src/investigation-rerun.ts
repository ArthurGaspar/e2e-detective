import { execFile } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { readReport } from "./evidence";
import { applyHeal, parseLocator, type HealLead } from "./heal";
import { ROOT } from "./patrol";
import { scenarioById, testKey } from "./scenarios";
import { createSceneServer } from "./serve";
import type { CaseDoc } from "./store";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const quote = (text: string) => JSON.stringify(text).replace(/['`$]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

function replacement(lead: HealLead): string {
  const { role, name, testId } = lead.candidate;
  if (parseLocator(lead.locator).kind === "testid" && testId) return `getByTestId(${quote(testId)})`;
  if (role !== "generic" && name) return `getByRole(${quote(role)}, { name: ${quote(name)} })`;
  if (testId) return `getByTestId(${quote(testId)})`;
  return `getByText(${quote(name)})`;
}

export async function rerunCase(c: CaseDoc, lead: HealLead): Promise<{ outcome: string; error?: string }> {
  const broken = c.attempts.at(-1)?.locator;
  if (!broken) throw new Error("The case has no failed locator.");

  const tests = await realpath(join(ROOT, "tests"));
  const spec = await realpath(resolve(tests, c.test.file));
  const file = relative(tests, spec);
  if (!file.endsWith(".spec.ts") || isAbsolute(file) || file.startsWith(`..${sep}`)) {
    throw new Error("The case must refer to a spec inside the repository's tests directory.");
  }
  const patched = applyHeal(await readFile(spec, "utf8"), broken, replacement(lead), false);
  if (!patched) throw new Error("The failed locator was not found in the current spec.");

  const scratch = join(ROOT, ".patrol");
  await mkdir(scratch, { recursive: true });
  const work = await mkdtemp(join(scratch, "investigate-"));
  const server = createSceneServer();
  try {
    await Promise.all([
      cp(tests, join(work, "tests"), { recursive: true }),
      cp(join(ROOT, "agent", "src"), join(work, "agent", "src"), { recursive: true }),
      cp(join(ROOT, "playwright.config.ts"), join(work, "playwright.config.ts")),
    ]);
    await writeFile(join(work, "tests", file), patched);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The local crime scene has no HTTP port.");
    const reportPath = join(work, "report.json");
    const env = {
      ...process.env,
      TARGET_URL: `http://127.0.0.1:${address.port}/`,
      CHAOS_PLAN: JSON.stringify({ [testKey(file, c.test.title)]: scenarioById(c.truth.scenario).id }),
      PW_JSON_REPORT: reportPath,
      PW_OUTPUT_DIR: join(work, "results"),
    };
    let executionError: unknown;
    try {
      await run(process.execPath, [
        require.resolve("@playwright/test/cli"), "test", "--retries=0", "--workers=1",
        "--grep", ` ${escapeRegex(c.test.title)}$`, `(?:^|[/\\\\])${file.split(sep).map(escapeRegex).join("[/\\\\]")}$`,
      ], { cwd: work, env, timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      executionError = err;
    }
    let results;
    try {
      results = readReport(reportPath, testKey);
    } catch {
      throw new Error("Playwright did not produce a readable report. Check the local server and Chromium installation.");
    }
    if (results.length !== 1 || results[0].key !== testKey(file, c.test.title)) {
      if (executionError && typeof executionError === "object" && "stderr" in executionError && executionError.stderr) {
        throw new Error(String(executionError.stderr).trim().slice(0, 300));
      }
      throw new Error("Playwright did not produce a result for exactly the case test.");
    }
    const [result] = results;
    if (executionError && result.outcome !== "unexpected") throw new Error("Playwright failed during the rerun.");
    return { outcome: result.outcome, error: result.attempts[0]?.error.split("\n").slice(0, 6).join("\n").slice(0, 500) };
  } finally {
    server.close();
    await rm(work, { recursive: true, force: true, maxRetries: 4 });
  }
}
