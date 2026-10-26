/**
 * Self-healing leads: when a locator finds nothing, rank the elements that
 * are on the page by how likely they are its renamed successor.
 *
 * This is a cheap, deterministic pass that runs in CI. It catches renames that
 * keep some words ("Add evidence" -> "Log evidence") and misses pure synonyms
 * ("Case board" -> "Investigations"). The local LLM reviews the same page but,
 * in our evaluation, also missed those synonym renames.
 */
import type { Candidate } from "../../tests/fixtures";

export interface ParsedLocator {
  kind: "role" | "testid" | "text" | "label" | "other";
  role?: string;
  value: string;
}

export interface HealLead {
  locator: string;
  score: number;
  candidate: Candidate;
}

const ROLE_RE = /getByRole\(\s*['"](\w+)['"]\s*,\s*\{[^}]*name:\s*(['"])(.*?)\2/;
const SIMPLE_RE = /getBy(TestId|Text|Label)\(\s*(['"])(.*?)\2/;

export function parseLocator(locator: string): ParsedLocator {
  const role = locator.match(ROLE_RE);
  if (role) return { kind: "role", role: role[1], value: role[3] };
  const simple = locator.match(SIMPLE_RE);
  if (simple) {
    const kind = ({ TestId: "testid", Text: "text", Label: "label" } as const)[simple[1] as "TestId" | "Text" | "Label"];
    return { kind, value: simple[3] };
  }
  return { kind: "other", value: locator };
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function trigrams(s: string): Set<string> {
  const t = ` ${s.toLowerCase()} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

const jaccard = <T>(a: Set<T>, b: Set<T>) => {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** 0..1 similarity mixing whole-word overlap and character trigrams. */
export function similarity(a: string, b: string): number {
  return 0.6 * jaccard(new Set(words(a)), new Set(words(b))) + 0.4 * jaccard(trigrams(a), trigrams(b));
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function locatorFor(target: ParsedLocator, c: Candidate): string {
  if (target.kind === "testid" && c.testId) return `getByTestId(${quote(c.testId)})`;
  if (c.role !== "generic" && c.name) return `getByRole(${quote(c.role)}, { name: ${quote(c.name)} })`;
  if (c.testId) return `getByTestId(${quote(c.testId)})`;
  return `getByText(${quote(c.name)})`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces `broken` with `replacement` in a spec's source. Error messages print
 * locators with single quotes, while the source may use double quotes and
 * different spacing, so quotes and whitespace are matched loosely. Returns
 * null when the locator isn't found.
 */
export function applyHeal(source: string, broken: string, replacement: string): string | null {
  const parts = broken.match(/'(?:[^'\\]|\\.)*'|[^']+/g) ?? [broken];
  const pattern = parts
    .map((p) => (p.startsWith("'") ? `["']${escapeRe(p.slice(1, -1))}["']` : escapeRe(p).replace(/\s+/g, "\\s*")))
    .join("");
  const re = new RegExp(pattern);
  if (!re.test(source)) return null;
  // The suggestion uses single quotes; keep the spec's own quote style.
  const quote = source.match(re)![0].includes('"') ? '"' : "'";
  return source.replace(re, quote === '"' ? replacement.replace(/'((?:[^'\\]|\\.)*)'/g, '"$1"') : replacement);
}

export function healLeads(locator: string | null, candidates: Candidate[], limit = 3): HealLead[] {
  if (!locator) return [];
  const target = parseLocator(locator);
  if (target.kind === "other") return [];
  const leads = candidates
    .filter((c) => c.name || c.testId)
    .map((c) => {
      const text = target.kind === "testid" ? c.testId ?? "" : c.name;
      let score = similarity(target.value, text);
      if (target.kind === "testid" && c.name) score = Math.max(score, 0.8 * similarity(target.value.replace(/[-_]/g, " "), c.name));
      if (target.role && c.role === target.role) score = Math.min(1, score + 0.15);
      // An exact match would have been found by the original locator; it isn't a rename.
      if (text === target.value && (!target.role || c.role === target.role)) score = 0;
      return { locator: locatorFor(target, c), score: Math.round(score * 1000) / 1000, candidate: c };
    })
    .filter((l) => l.score > 0.15)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return leads.filter((l) => !seen.has(l.locator) && seen.add(l.locator)).slice(0, limit);
}
