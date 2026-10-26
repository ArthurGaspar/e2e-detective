import { Empty } from "./Board";
import { loadIndex } from "./data";
import { useAsync, when } from "./ui";

export function Patrols() {
  const { data: index, error } = useAsync(loadIndex, []);
  if (error) return <Empty title="No patrols yet">{error}</Empty>;
  if (!index) return <Empty title="Loading the patrol log…" />;
  return (
    <>
      <section>
        <h1>Patrol log</h1>
        <p>Each patrol runs every journey once against the crime scene, like synthetic monitoring, except that faults are planted so the verdicts can be checked.</p>
      </section>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Trigger</th>
              <th>Tests</th>
              <th className="num">Passed</th>
              <th className="num">Flaky</th>
              <th className="num">Failed</th>
            </tr>
          </thead>
          <tbody>
            {index.runs.slice(0, 100).map((r) => (
              <tr key={r._id}>
                <td>{when(r.startedAt)}</td>
                <td>{r.trigger}</td>
                <td>
                  <div className="strip" aria-label={`${r.passed} passed, ${r.flaky} flaky, ${r.failed} failed`}>
                    {Array.from({ length: r.passed }, (_, i) => <span key={`p${i}`} style={{ background: "var(--good)" }} />)}
                    {Array.from({ length: r.flaky }, (_, i) => <span key={`f${i}`} style={{ background: "var(--c-outdated_test)" }} />)}
                    {Array.from({ length: r.failed }, (_, i) => <span key={`x${i}`} style={{ background: "var(--critical)" }} />)}
                  </div>
                </td>
                <td className="num">{r.passed}</td>
                <td className="num">{r.flaky}</td>
                <td className="num">{r.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small" style={{ marginTop: 8 }}>Updated {when(index.updatedAt)}.</p>
      </section>
    </>
  );
}
