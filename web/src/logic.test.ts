import { describe, expect, it } from "vitest";
import { isCorrect, matchesFilter, planCycle, segments, wrongInCycle } from "./logic";
import type { AppState, Cycle, Word } from "./types";
import { DEFAULT_FILTER, DEFAULT_SETTINGS } from "./types";

const word = (id: string, extra: Partial<Word> = {}): Word => ({
  id, w: id, pos: ["n"], cefr: "B1", eiken: null, toeic: false, toefl: false, lists: [], zipf: 4,
  ipa: {}, senses: [{ p: "n", d: "def", s: [] }], ex: [], col: [], ...extra,
});

const ws = Array.from({ length: 30 }, (_, i) => word("w" + i, { cefr: i < 20 ? "B1" : "C1" }));

const cycle = (ids: string[]): Cycle => ({
  id: "c1", name: "c1", createdAt: "2026-01-01", filter: DEFAULT_FILTER, size: ids.length, reviewRatio: 0,
  wordIds: ids, carriedIds: [], reviewIds: [],
});

const stateWith = (c: Cycle, results: Record<string, boolean>[]): AppState => ({
  version: 1, settings: { ...DEFAULT_SETTINGS }, cycles: [c],
  attempts: results.map((r, i) => ({
    id: "a" + i, cycleId: c.id, mode: "paper", createdAt: `2026-01-0${i + 2}`, completedAt: `2026-01-0${i + 2}`,
    order: c.wordIds, results: r,
  })),
});

describe("segments", () => {
  it("splits marked headwords", () => {
    expect(segments("a [[cat]] sat")).toEqual([
      { text: "a ", hit: false }, { text: "cat", hit: true }, { text: " sat", hit: false },
    ]);
  });
});

describe("grading", () => {
  it("is case/space insensitive", () => {
    expect(isCorrect(word("decide"), "  Decide ")).toBe(true);
    expect(isCorrect(word("decide"), "decided")).toBe(false);
    expect(isCorrect(word("decide"), "")).toBe(false);
  });
});

describe("filter", () => {
  it("any vs all", () => {
    const w = word("x", { cefr: "C1", toefl: true });
    expect(matchesFilter(w, { ...DEFAULT_FILTER, cefr: ["C1"], toeic: true, mode: "any" })).toBe(true);
    expect(matchesFilter(w, { ...DEFAULT_FILTER, cefr: ["C1"], toeic: true, mode: "all" })).toBe(false);
    expect(matchesFilter(w, { ...DEFAULT_FILTER, cefr: ["C1"], toefl: true, mode: "all" })).toBe(true);
  });
});

describe("cycles", () => {
  const c = cycle(["w0", "w1", "w2", "w3"]);
  it("carries over words missed in any test", () => {
    const st = stateWith(c, [{ w0: false, w1: true, w2: true, w3: true }, { w0: true, w1: false, w2: true, w3: true }]);
    expect(wrongInCycle(st, c, "any-wrong")).toEqual(["w0", "w1"]);
    expect(wrongInCycle(st, c, "last-wrong")).toEqual(["w1"]);
  });
  it("plans carried + review + fresh without duplicates", () => {
    const st = stateWith(c, [{ w0: false, w1: true, w2: true, w3: true }]);
    const plan = planCycle(st, ws, DEFAULT_FILTER, 10, 0.5, c);
    expect(plan.carried).toEqual(["w0"]);
    expect(plan.review.length).toBe(3); // only w1..w3 were studied before
    expect(plan.fresh.length).toBe(6);
    const all = [...plan.carried, ...plan.review, ...plan.fresh];
    expect(new Set(all).size).toBe(10);
    expect(plan.fresh.every((id) => !c.wordIds.includes(id))).toBe(true);
  });
});
