import { useState } from "react";
import { CAUSE_LABEL, CAUSES, loadIndex, type Cause } from "./data";
import { CauseChip, Tile, caseNo, causeColor, pct, useAsync, when } from "./ui";

type Filter = Cause | "all" | "wrong";
const PAGE_SIZE = 20;

export function Board() {
  const { data: index, error } = useAsync(loadIndex, []);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const judged = index?.cases.filter((c) => c.truth) ?? [];
  const right = judged.filter((c) => c.verdict === c.truth).length;
  const shown = (index?.cases ?? []).filter((c) =>
    (filter === "all" || (filter === "wrong" ? c.truth && c.verdict !== c.truth : c.verdict === filter)) &&
    `${c.test} ${c._id}`.toLowerCase().includes(query.toLowerCase().trim()),
  );

  return (
    <>
      <section className="intro" aria-labelledby="intro-title">
        <div className="intro-copy">
          <p className="eyebrow">Arthur Gaspar / Engineering notebook 01</p>
          <h1 id="intro-title">A failed test is<br />a starting point.</h1>
          <p className="intro-deck">The useful part is finding out why.</p>
          <p>Case Files turns Playwright traces into evidence for four possible causes: timing, infrastructure, an app bug, or a test that needs updating.</p>
          <div className="intro-links">
            <a className="button-link" href="#archive">Inspect the evidence <span aria-hidden="true">↓</span></a>
            <a href="#/model">Read the method ↗</a>
          </div>
        </div>
        <aside className="field-note">
          <span className="eyebrow">01 / Why I built this</span>
          <h2>The work after the red check.</h2>
          <p>At Voidr, I worked on Playwright monitoring for critical user journeys. Investigating a failure meant reading the trace, checking the network, and deciding what actually needed fixing.</p>
          <p>This is my small, public experiment with that workflow. I plant faults in a fictional São Paulo detective agency so each diagnosis has a known answer to check against.</p>
          <a href="crime-scene/">Explore the test target ↗</a>
          <span className="note-caption">Demo sign-in: <code>221B</code> / <code>elementary</code></span>
        </aside>
      </section>

      <div className="pipeline" aria-label="Investigation process">
        <span><b>01</b> Run a journey</span><span aria-hidden="true">→</span>
        <span><b>02</b> Read the trace</span><span aria-hidden="true">→</span>
        <span><b>03</b> Compare diagnoses</span><span aria-hidden="true">→</span>
        <span><b>04</b> Check the known cause</span>
      </div>

      <section id="archive" className="archive" aria-labelledby="archive-title">
        <div className="section-heading">
          <div><p className="eyebrow">02 / The evidence</p><h2 id="archive-title">Case archive</h2></div>
          {index && <span className="small">{index.source === "sample" ? "Reference archive · 26 Oct 2026" : `Archive updated ${when(index.updatedAt)}`}</span>}
        </div>
        {index?.source === "sample" && <p className="archive-notice">The live archive is unavailable. This selection preserves historical rules-based diagnoses, including mistakes. These are saved cases, not current monitoring or a classifier benchmark.</p>}
        {error ? <Empty title="The archive could not be opened">Try reloading the page. The method and source code are still available above.</Empty> : !index ? <p role="status">Loading recorded failures…</p> : <>
          <div className="tiles">
            <Tile value={index.cases.length} label="Recorded failures" sub={`${index.runs.length} runs in this archive`} />
            {index.source === "sample"
              ? <Tile value={CAUSES.length} label="Known failure causes" sub="illustrative selection · includes wrong diagnoses" />
              : <Tile value={judged.length ? pct(right / judged.length) : "—"} label="Diagnoses matching the cause" sub={`${right} of ${judged.length} labeled cases · not a validation score`} />}
            <Tile value={index.cases.filter((c) => c.healable).length} label="Locator suggestions" sub="proposals for review, not verified fixes" />
          </div>
          <div className="archive-tools">
            <div className="filters" role="group" aria-label="Filter cases">
              {(["all", ...CAUSES, "wrong"] as Filter[]).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => { setFilter(f); setVisible(PAGE_SIZE); }}>
                {f === "all" ? "All causes" : f === "wrong" ? "Wrong diagnoses" : CAUSE_LABEL[f]}
              </button>)}
            </div>
            <label className="search">Find a case<input type="search" placeholder="Test name or case ID" value={query} onChange={(e) => { setQuery(e.target.value); setVisible(PAGE_SIZE); }} /></label>
          </div>
          <div className="archive-caption"><span>Journey / Recorded at</span><span>Diagnosis / Known cause</span></div>
          <ul className="cases">
            {shown.slice(0, visible).map((c) => <li key={c._id}>
              <a className="case-card" href={`#/case/${c._id}`} style={{ ["--cause" as string]: causeColor(c.verdict) }}>
                <span className="case-identity"><span className="no">{caseNo(c._id)} · {when(c.openedAt)}</span><span className="title">{c.test}</span><span className="case-tags">{c.reported ? "Includes independent LLM report" : "Trace analysis"}{c.healable && " · Locator suggestion"}</span></span>
                <span className="case-diagnosis"><CauseChip cause={c.verdict} /><span className="small">Known cause: {c.truth ? CAUSE_LABEL[c.truth] : "unlabeled"}</span></span>
                <span className={`case-result ${c.truth ? c.truth === c.verdict ? "ok" : "bad" : "muted"}`}>{c.truth ? c.truth === c.verdict ? "Match" : "Mismatch" : "Unscored"}<span aria-hidden="true"> ↗</span></span>
              </a>
            </li>)}
          </ul>
          <p className="small" role="status">{shown.length ? `${Math.min(visible, shown.length)} of ${shown.length} matching cases` : "No cases match these filters. Try another cause or search term."}</p>
          {shown.length > visible && <button className="load-more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>Show 20 more cases</button>}
        </>}
      </section>

      <section className="research-note">
        <span className="eyebrow">03 / What this experiment can tell us</span>
        <h2>A useful diagnosis needs a fair test.</h2>
        <p>The faults here are synthetic. Repeated journeys make this an easier problem than production, and the features were refined after inspecting errors. The archive shows individual predictions; cross-validation and baselines belong in the evaluation.</p>
        <a href="#/model">Inspect the evaluation and its limits ↗</a>
      </section>
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty" role="status"><h1>{title}</h1>{children && <p>{children}</p>}</div>;
}
