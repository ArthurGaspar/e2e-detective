import { Empty } from "./Board";
import { CAUSE_LABEL, CAUSES, FEATURE_LABEL, loadModel } from "./data";
import { Tile, causeColor, pct, useAsync } from "./ui";

/** Sequential blue steps for count cells; the darkest steps get light text. */
function seqStep(value: number, max: number): number {
  if (!value || !max) return 0;
  return Math.min(5, 1 + Math.floor((value / max) * 4.999));
}

export function ModelPage() {
  const { data: model, error } = useAsync(loadModel, []);
  if (error) return <Empty title="No trained model yet">Run <code>npm run sweep</code> and <code>npm run train</code>.</Empty>;
  if (!model) return <Empty title="Loading the model…" />;
  const m = model.metrics;

  return (
    <>
      <section>
        <h1>How the detective decides</h1>
        <p>
          A multinomial logistic regression over {model.features.length} clues extracted from each failure's Playwright trace and page. It
          was trained on {model.trainedOn} failures whose cause was injected on purpose, and is scored with {m?.folds ?? 5}-fold
          cross-validation against two baselines: always guessing the most common cause, and the checklist a QA engineer would apply by hand.
        </p>
      </section>

      {m && (
        <>
          <div className="tiles">
            <Tile value={pct(m.accuracy, 1)} label="Classifier accuracy" sub="cross-validated" />
            <Tile value={pct(m.rulesAccuracy, 1)} label="Hand-written rules" sub="passed on retry → flaky; 5xx → environment; …" />
            <Tile value={pct(m.majorityAccuracy, 1)} label="Always the most common cause" sub="the floor to beat" />
            <Tile value={m.samples} label="Labeled failures" />
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>Confusion matrix</h2>
              <p className="small">Rows: injected cause. Columns: the classifier's verdict. The diagonal is cases solved.</p>
              <Matrix confusion={m.confusion} />
            </section>
            <section className="card">
              <h2>Per cause</h2>
              <table>
                <thead>
                  <tr>
                    <th>Cause</th>
                    <th className="num">Precision</th>
                    <th className="num">Recall</th>
                    <th className="num">Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {CAUSES.map((c) => (
                    <tr key={c}>
                      <td>
                        <span className="dot" style={{ background: causeColor(c), display: "inline-block", marginRight: 6 }} />
                        {CAUSE_LABEL[c]}
                      </td>
                      <td className="num">{pct(m.perClass[c].precision)}</td>
                      <td className="num">{pct(m.perClass[c].recall)}</td>
                      <td className="num">{m.perClass[c].support}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small" style={{ marginTop: 10 }}>
                Precision: when the classifier names this cause, how often it's right. Recall: of the failures with this cause, how
                many it caught.
              </p>
            </section>
          </div>
        </>
      )}

      <section className="card">
        <h2>Which clues point where</h2>
        <p className="small">
          Weights on standardized features: positive values push towards the cause, negative values away from it. Larger magnitude,
          stronger clue.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Clue</th>
                {CAUSES.map((c) => (
                  <th key={c} className="num">{CAUSE_LABEL[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.features.map((f, j) => (
                <tr key={f}>
                  <td>{FEATURE_LABEL[f] ?? f}</td>
                  {model.classes.map((c, k) => {
                    const w = model.weights[k][j];
                    return (
                      <td key={c} className="num" style={{ color: Math.abs(w) < 0.15 ? "var(--ink-3)" : w > 0 ? "var(--ink)" : "var(--critical)", fontWeight: Math.abs(w) >= 0.8 ? 600 : 400 }}>
                        {w > 0 ? "+" : ""}
                        {w.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Matrix({ confusion }: { confusion: number[][] }) {
  const max = Math.max(...confusion.flat());
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="matrix">
        <thead>
          <tr>
            <th />
            {CAUSES.map((c) => (
              <th key={c}>{CAUSE_LABEL[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {confusion.map((row, i) => (
            <tr key={i}>
              <th className="rowh">{CAUSE_LABEL[CAUSES[i]]}</th>
              {row.map((v, j) => {
                const step = seqStep(v, max);
                return (
                  <td
                    key={j}
                    title={`Injected ${CAUSE_LABEL[CAUSES[i]]}, judged ${CAUSE_LABEL[CAUSES[j]]}: ${v}`}
                    style={{ background: `var(--seq-${step})`, color: step >= 3 ? "#fff" : "var(--ink)", outline: i === j ? "2px solid var(--ink)" : undefined, outlineOffset: -2 }}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
