import { Binary, MongoClient, type Db } from "mongodb";
import { JsonStore, KEEP_CASES, KEEP_RUNS, type CaseDoc, type RunDoc, type Store } from "./store";

interface ScreenshotDoc { _id: string; data: Binary }

/** MongoDB is authoritative; rebuildIndex exports the retained archive for static hosting. */
export class MongoStore implements Store {
  private cases;
  private runs;
  private screenshots;

  constructor(private client: MongoClient, db: Db, private dir: string) {
    this.cases = db.collection<CaseDoc>("cases");
    this.runs = db.collection<RunDoc>("runs");
    this.screenshots = db.collection<ScreenshotDoc>("screenshots");
  }

  static async connect(uri: string, dir: string): Promise<MongoStore> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    try {
      await client.connect();
      return new MongoStore(client, client.db(), dir);
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async close() { await this.client.close(); }

  async saveRun(run: RunDoc) {
    await this.runs.replaceOne({ _id: run._id }, run, { upsert: true });
  }

  async saveCase(c: CaseDoc, screenshot: Uint8Array | null) {
    if (screenshot) {
      await this.screenshots.updateOne({ _id: c._id }, { $set: { data: new Binary(screenshot) } }, { upsert: true });
      c.screenshot = `cases/${c._id}.jpg`;
    }
    await this.cases.replaceOne({ _id: c._id }, c, { upsert: true });
  }

  async getCase(id: string): Promise<CaseDoc | null> {
    return this.cases.findOne({ _id: id });
  }

  async listCases(): Promise<CaseDoc[]> {
    return this.cases.find().toArray();
  }

  async rebuildIndex() {
    const cases = await this.cases.find().sort({ _id: -1 }).toArray();
    const runs = await this.runs.find().sort({ _id: -1 }).toArray();
    const oldCases = cases.splice(KEEP_CASES).map((c) => c._id);
    const oldRuns = runs.splice(KEEP_RUNS).map((r) => r._id);
    if (oldCases.length) {
      await this.cases.deleteMany({ _id: { $in: oldCases } });
      await this.screenshots.deleteMany({ _id: { $in: oldCases } });
    }
    if (oldRuns.length) await this.runs.deleteMany({ _id: { $in: oldRuns } });

    const archive = new JsonStore(this.dir);
    // Remove stale JSON documents from earlier exports before writing this snapshot.
    await archive.clearArchive();
    for (const run of runs) await archive.saveRun(run);
    for (const c of cases) {
      const shot = c.screenshot ? await this.screenshots.findOne({ _id: c._id }) : null;
      await archive.saveCase(c, shot ? shot.data.value() : null);
    }
    return archive.rebuildIndex();
  }
}
