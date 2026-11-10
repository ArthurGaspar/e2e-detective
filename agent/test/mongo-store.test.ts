import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient, type Db } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MongoStore } from "../src/mongo-store";
import { createStore, JsonStore, KEEP_CASES, KEEP_RUNS, type CaseDoc, type RunDoc } from "../src/store";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "mongo-store-"));
  dirs.push(dir);
  return dir;
};
const fixture = (): CaseDoc => JSON.parse(readFileSync(new URL("../../dashboard/public/sample/cases/20261026T201535Z-26ah13-3.json", import.meta.url), "utf8"));

// In-memory driver boundary: exercise the adapter and real JSON export without a server.
function setup() {
  const collections = new Map<string, ReturnType<typeof collection>>();
  function collection() {
    const docs = new Map<string, any>();
    return {
      docs,
      replaceOne: vi.fn(async ({ _id }, doc) => { docs.set(_id, structuredClone(doc)); }),
      updateOne: vi.fn(async ({ _id }, { $set }) => { docs.set(_id, { _id, ...$set }); }),
      findOne: vi.fn(async ({ _id }) => docs.get(_id) ?? null),
      find: () => {
        let values = [...docs.values()];
        return {
          sort: () => { values.sort((a, b) => b._id.localeCompare(a._id)); return { toArray: async () => values }; },
          toArray: async () => values,
        };
      },
      deleteMany: vi.fn(async ({ _id }) => { for (const id of _id.$in) docs.delete(id); }),
    };
  }
  const db = { collection: (name: string) => {
    if (!collections.has(name)) collections.set(name, collection());
    return collections.get(name)!;
  } };
  const close = vi.fn(async () => {});
  const dir = directory();
  const store = new MongoStore({ close } as unknown as MongoClient, db as unknown as Db, dir);
  return { store, dir, collections, close };
}

describe("MongoDB adapter", () => {
  it("selects JSON without a URI and MongoDB when configured", async () => {
    const json = await createStore(directory(), "");
    expect(json).toBeInstanceOf(JsonStore);
    await json.close();
    vi.spyOn(MongoClient.prototype, "connect").mockResolvedValue({} as MongoClient);
    const close = vi.spyOn(MongoClient.prototype, "close").mockResolvedValue();
    const mongo = await createStore(directory(), "mongodb://localhost/e2e_detective");
    expect(mongo).toBeInstanceOf(MongoStore);
    await mongo.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a failed connection and propagates the error instead of falling back", async () => {
    vi.spyOn(MongoClient.prototype, "connect").mockRejectedValue(new Error("unavailable"));
    const close = vi.spyOn(MongoClient.prototype, "close").mockResolvedValue();
    await expect(createStore(directory(), "mongodb://localhost/test")).rejects.toThrow("unavailable");
    expect(close).toHaveBeenCalledOnce();
  });

  it("upserts cases and exports reports with their original screenshot", async () => {
    const { store, dir, collections, close } = setup();
    expect(await store.getCase("missing")).toBeNull();
    const c = fixture();
    await store.saveCase(c, new Uint8Array([1, 2, 3]));
    c.report = { verdict: "real_bug", confidence: 0.61, model: "test", writtenAt: c.openedAt, summary: "Report", clues: [], nextStep: "Review" };
    await store.saveCase(c, null);
    expect(await store.getCase(c._id)).toEqual(c);
    expect(await store.listCases()).toHaveLength(1);
    expect(collections.get("cases")!.replaceOne).toHaveBeenLastCalledWith({ _id: c._id }, c, { upsert: true });
    const index = await store.rebuildIndex();
    expect(index.cases[0]).toMatchObject({ verdict: "real_bug", confidence: 0.61, reported: true });
    expect([...readFileSync(join(dir, c.screenshot!))]).toEqual([1, 2, 3]);
    expect(JSON.parse(readFileSync(join(dir, `cases/${c._id}.json`), "utf8"))).toEqual(c);
    await store.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("retains the newest cases/runs, removes old images and replaces stale exports", async () => {
    const { store, dir, collections } = setup();
    const c = fixture();
    for (let i = 0; i <= KEEP_CASES; i++) {
      await store.saveCase({ ...c, _id: String(i).padStart(4, "0") }, new Uint8Array([i % 256]));
    }
    const run: RunDoc = { _id: "", startedAt: c.openedAt, finishedAt: c.openedAt, target: "test", trigger: "manual", tests: [
      { key: "a", title: "a", outcome: "expected", durationMs: 1, scenario: "clean", cause: null },
      { key: "b", title: "b", outcome: "unexpected", durationMs: 1, scenario: "clean", cause: null },
      { key: "c", title: "c", outcome: "flaky", durationMs: 1, scenario: "clean", cause: null },
    ] };
    for (let i = 0; i <= KEEP_RUNS; i++) await store.saveRun({ ...run, _id: String(i).padStart(4, "0") });
    const json = new JsonStore(dir);
    await json.saveCase({ ...c, _id: "stale" }, new Uint8Array([9]));
    writeFileSync(join(dir, "model.json"), "{}");
    const index = await store.rebuildIndex();
    expect(index.cases).toHaveLength(KEEP_CASES);
    expect(index.runs).toHaveLength(KEEP_RUNS);
    expect(index.cases[0]._id).toBe("0400");
    expect(index.runs[0]).toMatchObject({ _id: "0300", passed: 1, failed: 1, flaky: 1 });
    expect(await store.getCase("0000")).toBeNull();
    expect(collections.get("screenshots")!.docs.has("0000")).toBe(false);
    expect(existsSync(join(dir, "cases/stale.jpg"))).toBe(false);
    expect(existsSync(join(dir, "cases/stale.json"))).toBe(false);
    expect(existsSync(join(dir, "model.json"))).toBe(true);
  });
});
