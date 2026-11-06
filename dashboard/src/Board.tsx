import { useEffect, useState } from "react";
import { CAUSE_LABEL, CAUSES, loadCase, loadIndex, type Cause } from "./data";
import { CauseChip, caseNo, useAsync, when } from "./ui";

type Filter = Cause | "all";
const PAGE_SIZE = 20;

export function Board() {
  const { data: index, error } = useAsync(loadIndex, []);
  const [filter, setFilter] = useState<Filter>("all");
  const [wrongOnly, setWrongOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const search = query.trim().toLowerCase();
  const shown = (index?.cases ?? []).filter((c) =>
    (filter === "all" || c.verdict === filter) &&
    (!wrongOnly || (c.truth && c.truth !== c.verdict)) &&
    `${c.test} ${c._id}`.toLowerCase().includes(search),
  );
  const selected = shown.find((c) => c._id === selectedId) ?? shown[0];
  const wrong = index?.cases.filter((c) => c.truth && c.truth !== c.verdict).length ?? 0;

  return (
    <>
      <section className="desk-heading">
        <div>
          <p className="eyebrow">São Paulo / Test failure investigations</p>
          <h1>Case desk<span className="heading-period">.</span></h1>
        </div>
        <div className="desk-status">
          <span className="status-lamp" aria-hidden="true" />
          <span>{index?.source === "live" ? "Archive connected" : "Reference archive"}</span>
          <span className="desk-date">{index ? when(index.updatedAt) : "Opening records…"}</span>
        </div>
      </section>

      {index?.source === "sample" && (
        <p className="archive-notice">
          <b>Reference copy</b> Eight saved cases from 26 Oct 2026. Original rules-based findings, including mistakes. Live archive unavailable.
        </p>
      )}

      {error ? (
        <Empty title="Archive unavailable">Reload to try again.</Empty>
      ) : !index ? (
        <p role="status">Opening the case register…</p>
      ) : (
        <div className="case-desk">
          <section className="case-register" aria-labelledby="register-title">
            <div className="folder-tab"><span>Register</span><span>{String(index.cases.length).padStart(2, "0")} files</span></div>
            <div className="register-controls">
              <div className="register-title">
                <h2 id="register-title">Case register</h2>
                <span>{wrong} to review</span>
              </div>
              <label className="search">
                Find a case
                <input type="search" placeholder="Test name or file number…" value={query}
                  onChange={(e) => { setQuery(e.target.value); setVisible(PAGE_SIZE); }} />
              </label>
              <div className="register-filters">
                <label className="cause-filter">
                  <span>Diagnosis</span>
                  <select value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setVisible(PAGE_SIZE); }}>
                    <option value="all">All causes</option>
                    {CAUSES.map((cause) => <option key={cause} value={cause}>{CAUSE_LABEL[cause]}</option>)}
                  </select>
                </label>
                <button className="review-filter" aria-pressed={wrongOnly}
                  onClick={() => { setWrongOnly((value) => !value); setVisible(PAGE_SIZE); }}>
                  Wrong diagnoses <span>{wrong}</span>
                </button>
              </div>
            </div>
            <ul className="cases">
              {shown.slice(0, visible).map((c) => (
                <li key={c._id}>
                  <button className="case-card" aria-pressed={selected?._id === c._id}
                    onClick={() => setSelectedId(c._id)}>
                    <span className="file-glyph" aria-hidden="true" />
                    <span className="case-identity">
                      <span className="no">{caseNo(c._id)}</span>
                      <span className="title">{c.test}</span>
                      <span className="case-row-meta"><CauseChip cause={c.verdict} />{when(c.openedAt)}</span>
                    </span>
                    <span className={`register-mark ${c.truth && c.truth !== c.verdict ? "bad" : "muted"}`}>
                      {c.truth && c.truth !== c.verdict ? "!" : "↗"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="register-count" role="status">
              {shown.length ? `${Math.min(visible, shown.length)} / ${shown.length} files` : "No cases match these filters. Try another cause or search term."}
            </p>
            {shown.length > visible && (
              <button className="load-more" onClick={() => setVisible((n) => n + PAGE_SIZE)}>Show 20 more files</button>
            )}
          </section>

          {selected ? <CasePreview key={selected._id} id={selected._id} reveal={selectedId === selected._id} /> : (
            <div className="no-selection"><p>Select a different filter to open a file.</p></div>
          )}
        </div>
      )}
      <aside className="desk-footnote">
        <span>Control room</span>
        <a href="crime-scene/">Enter test target ↗</a>
        <span>Badge <code>221B</code> / Password <code>elementary</code></span>
        <a href="#/model">Classification method & results ↗</a>
      </aside>
    </>
  );
}

function CasePreview({ id, reveal }: { id: string; reveal: boolean }) {
  const { data: c, error } = useAsync(() => loadCase(id), [id]);
  useEffect(() => {
    if (c && reveal && window.matchMedia("(max-width: 760px)").matches) {
      document.getElementById("selected-case")?.scrollIntoView({ block: "start" });
    }
  }, [c, reveal]);
  if (error) return <Empty title="File unavailable">Try another case in the register.</Empty>;
  if (!c) return <div className="evidence-document" role="status">Retrieving evidence…</div>;

  const last = c.attempts.at(-1);
  const diagnosis = c.report?.verdict ?? c.verdict.cause;
  const mismatch = c.truth.cause && diagnosis !== c.truth.cause;
  const author = c.report ? "LLM report" : c.verdict.by === "model" ? "Classifier" : "Rules";

  return (
    <article id="selected-case" className="evidence-document" aria-label="Selected case evidence">
      <div className="document-ruler"><span>Investigation file</span><span>{caseNo(c._id)}</span></div>
      <header className="document-heading">
        <div>
          <p className="eyebrow">Playwright / {c.attempts.length} recorded attempts</p>
          <h2>{c.test.title}</h2>
        </div>
        <span className={`rubber-stamp ${mismatch ? "bad" : "ok"}`}>{mismatch ? "Review\nrequired" : c.truth.cause ? "Cause\nmatched" : "Unscored"}</span>
      </header>
      <div className="file-facts">
        <span><b>Filed</b> {when(c.openedAt)}</span>
        <span><b>Source</b> {author}</span>
        <span><b>Outcome</b> {c.outcome === "flaky" ? "Passed on retry" : "Failed"}</span>
      </div>

      {c.screenshot && (
        <figure className="evidence-photo">
          <span className="paperclip" aria-hidden="true" />
          <img src={c.screenshot} alt={`Recorded page for ${c.test.title}`} />
          <figcaption><span>Exhibit A / Last trace frame</span><span>Original capture</span></figcaption>
        </figure>
      )}

      <div className="case-findings">
        <section className="finding">
          <h3><span>01</span> Diagnosis</h3>
          <p className="finding-cause"><CauseChip cause={diagnosis} /></p>
          <p className="small">Injected cause: <b>{c.truth.cause ? CAUSE_LABEL[c.truth.cause] : "None"}</b></p>
          {mismatch && <p className="review-annotation">Finding does not match the planted fault.</p>}
        </section>
        <section className="finding failure-record">
          <h3><span>02</span> Failure record</h3>
          <pre>{last?.error.split("\n").filter(Boolean).slice(0, 4).join("\n") || "No error text captured."}</pre>
        </section>
      </div>
      <div className="document-actions">
        <span>{last?.api.length ?? 0} API calls · {c.healLeads.length} locator leads</span>
        <a href={`#/case/${c._id}`}>Open full case file <span aria-hidden="true">↗</span></a>
      </div>
    </article>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty" role="status">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}
