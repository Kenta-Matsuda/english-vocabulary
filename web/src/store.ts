import { get, set } from "idb-keyval";
import { useEffect, useState } from "preact/hooks";
import type { AppState, Dataset, Word } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const KEY = "vocab-trainer-state";

const emptyState = (): AppState => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, cycles: [], attempts: [] });

let state: AppState = emptyState();
const listeners = new Set<() => void>();

export async function initStore(): Promise<void> {
  const saved = (await get(KEY)) as AppState | undefined;
  if (saved) state = migrate(saved);
}

function migrate(s: Partial<AppState>): AppState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) },
    cycles: s.cycles ?? [],
    attempts: s.attempts ?? [],
  };
}

export function getState(): AppState {
  return state;
}

export function update(fn: (s: AppState) => AppState | void): void {
  const draft = structuredClone(state);
  state = (fn(draft) as AppState | undefined) ?? draft;
  void set(KEY, state);
  listeners.forEach((l) => l());
}

export function useAppState(): AppState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return state;
}

// ---------------------------------------------------------------- import / export

export function exportJson(includeApiKey: boolean): string {
  const s = structuredClone(state);
  if (!includeApiKey) s.settings.geminiApiKey = "";
  return JSON.stringify({ app: "vocab-trainer", exportedAt: new Date().toISOString(), state: s }, null, 1);
}

export function importJson(text: string, mode: "replace" | "merge"): { cycles: number; attempts: number } {
  const parsed = JSON.parse(text);
  const incoming = migrate(parsed.state ?? parsed);
  update((s) => {
    if (mode === "replace") {
      const key = s.settings.geminiApiKey;
      const next = incoming;
      if (!next.settings.geminiApiKey) next.settings.geminiApiKey = key;
      return next;
    }
    const cyc = new Map(s.cycles.map((c) => [c.id, c]));
    for (const c of incoming.cycles) cyc.set(c.id, c);
    const att = new Map(s.attempts.map((a) => [a.id, a]));
    for (const a of incoming.attempts) att.set(a.id, a);
    s.cycles = [...cyc.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    s.attempts = [...att.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
  return { cycles: incoming.cycles.length, attempts: incoming.attempts.length };
}

// ---------------------------------------------------------------- dataset

let dataset: Dataset | null = null;
let byId = new Map<string, Word>();

export async function loadDataset(): Promise<Dataset> {
  if (dataset) return dataset;
  const res = await fetch(new URL("data/words.json", document.baseURI));
  if (!res.ok) throw new Error(`Failed to load dataset: ${res.status}`);
  dataset = (await res.json()) as Dataset;
  byId = new Map(dataset.words.map((w) => [w.id, w]));
  return dataset;
}

export function words(): Word[] {
  return dataset?.words ?? [];
}

export function wordById(id: string): Word | undefined {
  return byId.get(id);
}
