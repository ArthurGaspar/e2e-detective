import { Empty } from "./Board";
import { CAUSE_BLURB, CAUSE_LABEL, FEATURE_LABEL, assetUrl, loadCase, type CaseDoc } from "./data";
import { CauseChip, SuspectBars, caseNo, causeColor, pct, useAsync, when } from "./ui";

export function CaseFile({ id }: { id: string }) {
  const { data: c, error } = useAsync(() => loadCase(id), [id]);
  if (error) return <Empty title="Case file missing">{error}</Empty>;
  if (!c) return <Empty title="Pulling the case file…" />;

  const last = c.attempts[c.attempts.length - 1];
  const verdict = c.report?.verdict ?? c.verdict.cause;
  const solved = c.truth.cause ? verdict === c.truth.cause : null;

  return (
    <>
      <a className="back" href="#/">← Case board</a>
      <section>
        <p className="small">
          Case {caseNo(c._id)} · opened {when(c.openedAt)} · run {c.runId}
        </p>
        <h1>{c.test.title}</h1>
        <p className="small">
          <code>tests/{c.test.file}</code> · {c.outcome === "flaky" ? "failed, then passed on retry" : `failed ${c.attempts.length} of ${c.attempts.length} attempts`}
        </p>
      </section>

      <div className="grid-3">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className="card">
            <h2>Evidence</h2>
            {c.attempts.map((a, i) => (
              <Attempt key={i} n={i + 1} a={a} />
            ))}
          </section>

          {c.screenshot && (
            <section className="card">
              <h2>The scene</h2>
              <img className="shot" src={assetUrl(c.screenshot)} alt={`The page when "${c.test.title}" failed`} loading="lazy" />
              <p className="small" style={{ marginTop: 8 }}>Last frame of the failing attempt, from the Playwright trace.</p>
            </section>
          )}

          <section className="card">
            <h2>Clues the classifier used</h2>
            <table>
              <tbody>
                {Object.entries(c.features)
                  .filter(([, v]) => v !== 0)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{FEATURE_LABEL[k] ?? k}</td>
                      <td className="num">{v}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className="card">
            <h2>Verdict</h2>
            <div className="verdict" style={{ borderColor: causeColor(verdict) }}>
              <span className="big" style={{ color: causeColor(verdict) }}>{CAUSE_LABEL[verdict]}</span>
              <span className="small">{CAUSE_BLURB[verdict]}</span>
              <span className="small">
                {c.report
                  ? `Named by the LLM (${c.report.model}), ${pct(c.report.confidence)} self-reported confidence.`
                  : `Named by the ${c.verdict.by === "model" ? "classifier" : "rules"}, ${pct(c.verdict.confidence)} confident.`}
              </span>
            </div>
            {solved !== null && (
              <p style={{ marginTop: 12 }}>
                <span className={`stamp ${solved ? "ok" : "bad"}`}>{solved ? "Case solved" : "Wrong suspect"}</span>
              </p>
            )}
            <p className="small" style={{ marginTop: 10 }}>
              Injected fault: <b>{c.truth.scenario}</b> ({c.truth.cause ? CAUSE_LABEL[c.truth.cause] : "none: this failure was not planted"}).
              Hidden from the classifier and the LLM.
            </p>
          </section>

          <section className="card">
            <h2>Suspects</h2>
            <SuspectBars probs={c.suspects} />
            <p className="small" style={{ marginTop: 10 }}>
              {c.verdict.by === "model" ? (
                <>
                  Classifier: <CauseChip cause={c.verdict.cause} /> · Rules: <CauseChip cause={c.rulesVerdict} />
                </>
              ) : (
                <>No trained model yet; the hand-written rules named <CauseChip cause={c.rulesVerdict} /></>
              )}
            </p>
          </section>

          <Interrogation c={c} />

          {(c.healLeads.length > 0 || c.report?.fixedLocator) && (
            <section className="card">
              <h2>Leads</h2>
              <p className="small">
                The test waited for <code>{last.locator}</code>, which isn't on the page. Likely replacements:
              </p>
              {c.report?.fixedLocator && (
                <div className="lead">
                  <code>{c.report.fixedLocator}</code>
                  <span className="score">LLM</span>
                </div>
              )}
              {c.healLeads.map((l) => (
                <div className="lead" key={l.locator}>
                  <code>{l.locator}</code>
                  <span className="score">{l.score.toFixed(2)}</span>
                </div>
              ))}
              <p className="small" style={{ marginTop: 8 }}>
                Apply locally with <code>npm run heal -- {c._id}</code>, then review the diff.
              </p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Attempt({ n, a }: { n: number; a: CaseDoc["attempts"][number] }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3>
        Attempt {n} <span className="small">({a.status}, {(a.durationMs / 1000).toFixed(1)} s)</span>
      </h3>
      <div className="error">
        <pre>{a.error.split("\n").slice(0, 12).join("\n")}</pre>
      </div>
      {a.api.length > 0 && (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>API call</th>
              <th className="num">Status</th>
              <th className="num">Time</th>
            </tr>
          </thead>
          <tbody>
            {a.api.map((n, i) => (
              <tr key={i}>
                <td>
                  <code>{new URL(n.url).pathname.replace(/^.*\/api\//, "api/")}{new URL(n.url).search}</code>
                </td>
                <td className={`num ${n.status === 0 || n.status >= 500 ? "bad" : ""}`}>{n.status || "no response"}</td>
                <td className={`num ${n.ms >= 3000 ? "bad" : ""}`}>{Math.round(n.ms)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {a.consoleErrors.length > 0 && (
        <p className="small" style={{ marginTop: 6 }}>
          Console: {a.consoleErrors.slice(0, 3).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Interrogation({ c }: { c: CaseDoc }) {
  if (!c.report) {
    return (
      <section className="card">
        <h2>Interrogation</h2>
        <div className="callout">
          <p>Not interrogated yet.</p>
          <p className="small" style={{ margin: 0 }}>
            LLM reports are written locally with Ollama (<code>npm run investigate</code>), so the scheduled patrol stays free and fast.
          </p>
        </div>
      </section>
    );
  }
  const r = c.report;
  return (
    <section className="card">
      <h2>Interrogation</h2>
      <p>{r.summary}</p>
      {r.clues.length > 0 && (
        <ul style={{ margin: "0 0 10px", paddingLeft: 18, color: "var(--ink-2)" }}>
          {r.clues.map((clue, i) => (
            <li key={i}>{clue}</li>
          ))}
        </ul>
      )}
      <p>
        <b>Next step:</b> {r.nextStep}
      </p>
      <p className="small">
        {r.model} · {when(r.writtenAt)}
        {r.verdict !== c.verdict.cause && ` · disagrees with the classifier (${CAUSE_LABEL[c.verdict.cause]})`}
      </p>
    </section>
  );
}
