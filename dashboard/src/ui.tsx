import { useEffect, useState, type ReactNode } from "react";
import { CAUSE_LABEL, CAUSES, type Cause } from "./data";

export const causeColor = (c: Cause) => `var(--c-${c})`;

export function CauseChip({ cause, suffix }: { cause: Cause | null; suffix?: ReactNode }) {
  if (!cause) return <span className="chip">Unknown</span>;
  return (
    <span className="chip">
      <span className="dot" style={{ background: causeColor(cause) }} />
      {CAUSE_LABEL[cause]}
      {suffix}
    </span>
  );
}

export function Tile({ value, label, sub }: { value: ReactNode; label: string; sub?: ReactNode }) {
  return (
    <div className="tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** One horizontal bar per cause; labels carry identity, so color is never the only cue. */
export function SuspectBars({ probs }: { probs: Record<Cause, number> }) {
  const order = [...CAUSES].sort((a, b) => probs[b] - probs[a]);
  return (
    <div className="bars" role="list" aria-label="Suspects and their probability">
      {order.map((c) => (
        <div className="bar-row" role="listitem" key={c} title={`${CAUSE_LABEL[c]}: ${(probs[c] * 100).toFixed(1)}%`}>
          <span>{CAUSE_LABEL[c]}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(probs[c] * 100, 0.5)}%`, background: causeColor(c) }} />
          </div>
          <span className="pct">{Math.round(probs[c] * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/** Runs `load` when `deps` change. `load` is a new closure on every render, so it isn't a dependency itself. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null });
    load().then(
      (data) => live && setState({ data, error: null }),
      (err) => live && setState({ data: null, error: String(err.message ?? err) }),
    );
    return () => {
      live = false;
    };
  }, deps);
  return state;
}

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "20261026T195545Z-7-1" -> "#26-1955-1": short, readable case numbers. */
export function caseNo(id: string): string {
  const m = id.match(/^\d{4}(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z-[a-z0-9]+-(\d+)$/);
  return m ? `#${m[1]}${m[2]}-${m[3]}${m[4]}-${m[5]}` : `#${id}`;
}
