import type { AppState, Attempt, Cycle, Settings, Word, WordFilter } from "./types";
import { SOURCE_LABEL } from "./types";

// ---------------------------------------------------------------- random

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function shuffle<T>(arr: readonly T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample<T>(arr: readonly T[], n: number): T[] {
  return shuffle(arr).slice(0, Math.max(0, n));
}

// ---------------------------------------------------------------- filtering

export function isTestable(w: Word): boolean {
  return w.senses.length > 0;
}

export function matchesFilter(w: Word, f: WordFilter): boolean {
  if (f.zipfMin != null && w.zipf < f.zipfMin) return false;
  if (f.zipfMax != null && w.zipf > f.zipfMax) return false;
  // (filters saved by older versions may still carry eiken/toeic/toefl fields; they are ignored)
  if (f.cefr?.length && !f.cefr.includes(w.cefr)) return false;
  if (f.sources?.length && !f.sources.includes(w.src)) return false;
  return true;
}

export function filterWords(words: Word[], f: WordFilter): Word[] {
  return words.filter((w) => isTestable(w) && matchesFilter(w, f));
}

export function describeFilter(f: WordFilter): string {
  const parts: string[] = [];
  parts.push(f.cefr?.length ? "CEFR " + f.cefr.join("/") : "CEFR A1–C2");
  if (f.sources?.length) parts.push("from " + f.sources.map((s) => SOURCE_LABEL[s]).join(", "));
  if (f.zipfMin != null || f.zipfMax != null) parts.push(`freq ${f.zipfMin ?? "-"}–${f.zipfMax ?? "-"}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- history / stats

export interface WordStat {
  tested: number;
  correct: number;
  lastResult?: boolean;
  lastAt?: string;
}

export function completedAttempts(state: AppState, cycleId?: string): Attempt[] {
  return state.attempts
    .filter((a) => a.results && (cycleId === undefined || a.cycleId === cycleId))
    .sort((a, b) => (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt));
}

export function wordStats(state: AppState): Map<string, WordStat> {
  const m = new Map<string, WordStat>();
  for (const a of completedAttempts(state)) {
    for (const [id, ok] of Object.entries(a.results!)) {
      const s = m.get(id) ?? { tested: 0, correct: 0 };
      s.tested++;
      if (ok) s.correct++;
      s.lastResult = ok;
      s.lastAt = a.completedAt;
      m.set(id, s);
    }
  }
  return m;
}

/** Words that count as "wrong" in a cycle and must be carried over to the next one. */
export function wrongInCycle(state: AppState, cycle: Cycle, rule: Settings["carryOverRule"]): string[] {
  const atts = completedAttempts(state, cycle.id);
  if (!atts.length) return [];
  const wrong = new Set<string>();
  if (rule === "last-wrong") {
    const last = new Map<string, boolean>();
    for (const a of atts) for (const [id, ok] of Object.entries(a.results!)) last.set(id, ok);
    for (const [id, ok] of last) if (!ok) wrong.add(id);
  } else {
    for (const a of atts) for (const [id, ok] of Object.entries(a.results!)) if (!ok) wrong.add(id);
  }
  return cycle.wordIds.filter((id) => wrong.has(id));
}

export function cycleSummary(state: AppState, cycle: Cycle) {
  const atts = completedAttempts(state, cycle.id);
  return atts.map((a) => {
    const r = Object.values(a.results!);
    return { attempt: a, correct: r.filter(Boolean).length, total: r.length };
  });
}

// ---------------------------------------------------------------- cycle creation

export interface CyclePlan {
  carried: string[];
  review: string[];
  fresh: string[];
  /** words available in each pool (for UI feedback) */
  available: { review: number; fresh: number };
}

/**
 * Build the word range of a new cycle.
 *  1. every word answered wrong in the previous cycle is carried over (mandatory)
 *  2. remaining slots: `reviewRatio` of them are filled with words already studied in earlier
 *     cycles (random), the rest with words never studied before (random), both within the filter.
 *  If one pool runs out, the other pool fills the gap.
 */
export function planCycle(
  state: AppState,
  words: Word[],
  filter: WordFilter,
  size: number,
  reviewRatio: number,
  previous: Cycle | undefined,
): CyclePlan {
  // words dropped from the dataset since the previous cycle was made cannot be carried over
  const known = new Set(words.map((w) => w.id));
  const carried = previous
    ? wrongInCycle(state, previous, state.settings.carryOverRule).filter((id) => known.has(id)).slice(0, size)
    : [];
  const carriedSet = new Set(carried);
  const studied = new Set(state.cycles.flatMap((c) => c.wordIds));
  for (const a of state.attempts) for (const id of a.order) studied.add(id);

  const pool = filterWords(words, filter).map((w) => w.id).filter((id) => !carriedSet.has(id));
  const reviewPool = pool.filter((id) => studied.has(id));
  const freshPool = pool.filter((id) => !studied.has(id));

  const rest = size - carried.length;
  let nReview = Math.round(rest * reviewRatio);
  let nFresh = rest - nReview;
  if (nReview > reviewPool.length) {
    nFresh += nReview - reviewPool.length;
    nReview = reviewPool.length;
  }
  if (nFresh > freshPool.length) {
    nReview = Math.min(reviewPool.length, nReview + nFresh - freshPool.length);
    nFresh = freshPool.length;
  }
  return {
    carried,
    review: sample(reviewPool, nReview),
    fresh: sample(freshPool, nFresh),
    available: { review: reviewPool.length, fresh: freshPool.length },
  };
}

// ---------------------------------------------------------------- grading

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z' -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCorrect(word: Word, answer: string): boolean {
  const a = normalizeAnswer(answer);
  if (!a) return false;
  return a === normalizeAnswer(word.w) || a === normalizeAnswer(word.id);
}

// ---------------------------------------------------------------- masked text

export type Segment = { text: string; hit: boolean };

/** Split "a [[word]] here" into segments; hit=true for the marked headword. */
export function segments(s: string): Segment[] {
  const out: Segment[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), hit: false });
    out.push({ text: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), hit: false });
  return out;
}

export function plain(s: string): string {
  return s.replace(/\[\[(.+?)\]\]/g, "$1");
}

export function hintFor(word: Word, settings: Settings): string {
  const w = word.w;
  const parts: string[] = [];
  if (settings.showFirstLetterHint) parts.push(`starts with “${w[0]}”`);
  if (settings.showLengthHint) parts.push(`${w.length} letters`);
  return parts.join(", ");
}

export function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
