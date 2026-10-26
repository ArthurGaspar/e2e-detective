import { useMemo, useState } from "react";
import { CAUSE_LABEL, CAUSES, loadIndex, type Cause } from "./data";
import { CauseChip, Tile, caseNo, causeColor, pct, useAsync, when } from "./ui";

type Filter = Cause | "all" | "wrong";

export function Board() {
  const { data: index, error } = useAsync(loadIndex, []);
  const [filter, setFilter] = useState<Filter>("all");

  const stats = useMemo(() => {
    if (!index) return null;
    const judged = index.cases.filter((c) => c.truth);
    const right = judged.filter((c) => c.verdict === c.truth).length;
    return {
      total: index.cases.length,
      accuracy: judged.length ? right / judged.length : 0,
      judged: judged.length,
      reported: index.cases.filter((c) => c.reported).length,
      healable: index.cases.filter((c) => c.healable).length,
      runs: index.runs.length,
    };
  }, [index]);

  if (error) return <Empty title="No case files yet">The patrol hasn't published anything ({error}).</Empty>;
  if (!index || !stats) return <Empty title="Opening the archive…" />;
  if (!index.cases.length) return <Empty title="All quiet">{stats.runs} patrol runs, no failures.</Empty>;

  const shown = index.cases.filter((c) =>
    filter === "all" ? true : filter === "wrong" ? c.truth && c.verdict !== c.truth : c.verdict === filter,
  );

  return (
    <>
      <section>
        <h1>Case board</h1>
        <p>
          Every failing end-to-end test is a case. A scheduled patrol runs the journeys against the{" "}
          <a href="crime-scene/">crime scene</a> with secretly injected faults, collects evidence from the Playwright traces, and
          names a culprit. The injected fault is revealed afterwards, so you can see how often the detective is right.
        </p>
      </section>

      <div className="tiles">
        <Tile value={stats.total} label="Cases on file" sub={`from ${stats.runs} patrol runs`} />
        <Tile value={pct(stats.accuracy)} label="Verdicts matching the injected fault" sub={`${stats.judged} cases with a known cause`} />
        <Tile value={stats.reported} label="Interrogated by the LLM" sub="reports written locally with Ollama" />
        <Tile value={stats.healable} label="With a heal lead" sub="a likely replacement locator" />
      </div>

      <section>
        <div className="filters" role="group" aria-label="Filter cases">
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All ({index.cases.length})
          </button>
          {CAUSES.map((c) => (
            <button key={c} aria-pressed={filter === c} onClick={() => setFilter(c)}>
              <span className="dot" style={{ background: causeColor(c) }} />
              {CAUSE_LABEL[c]} ({index.cases.filter((x) => x.verdict === c).length})
            </button>
          ))}
          <button aria-pressed={filter === "wrong"} onClick={() => setFilter("wrong")}>
            Wrong verdicts ({index.cases.filter((c) => c.truth && c.verdict !== c.truth).length})
          </button>
        </div>
      </section>

      <ul className="cases">
        {shown.slice(0, 120).map((c) => (
          <li key={c._id}>
            <a className="case-card" href={`#/case/${c._id}`} style={{ ["--cause" as string]: causeColor(c.verdict) }}>
              <span className="no">
                Case {caseNo(c._id)} · {when(c.openedAt)}
              </span>
              <span className="title">{c.test}</span>
              <span className="row">
                <CauseChip cause={c.verdict} suffix={<span className="muted">{pct(c.confidence)}</span>} />
                {c.reported && <span className="chip">LLM report</span>}
                {c.healable && <span className="chip">Heal lead</span>}
              </span>
              <span className="row">
                Injected: {c.truth ? CAUSE_LABEL[c.truth] : "nothing (genuine failure)"}{" "}
                {c.truth && (c.truth === c.verdict ? <b className="ok">✓ solved</b> : <b className="bad">✗ wrong suspect</b>)}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {shown.length > 120 && <p className="small">Showing the 120 most recent of {shown.length} cases.</p>}
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}
