// ---------- dataset (web/public/data/words.json) ----------

export interface Sense {
  /** part of speech: n v adj adv ... */
  p: string;
  /** definition; occurrences of the headword are wrapped in [[...]] */
  d: string;
  /** synonyms, already filtered (never contain the answer) and ranked by frequency */
  s: string[];
  /** "wkt" when the sense comes from Wiktionary instead of WordNet */
  src?: string;
}

export interface Word {
  id: string;
  w: string;
  pos: string[];
  cefr: Cefr | null;
  eiken: Eiken | null;
  toeic: boolean;
  toefl: boolean;
  lists: string[];
  /** Zipf frequency (wordfreq), ~1 (rare) .. 7 (very common) */
  zipf: number;
  ipa: { us?: string; uk?: string };
  senses: Sense[];
  /** example sentences with [[headword]] marked */
  ex: string[];
  /** collocations / short phrases with [[headword]] marked */
  col: string[];
}

export interface Dataset {
  meta: { built: string; stats: Record<string, number>; sources: Record<string, string> };
  words: Word[];
}

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];
export const EIKEN_GRADES = ["2", "pre1", "1"] as const;
export type Eiken = (typeof EIKEN_GRADES)[number];
export const EIKEN_LABEL: Record<Eiken, string> = { "2": "Eiken 2", pre1: "Eiken Pre-1", "1": "Eiken 1" };

// ---------- word filter ----------

export interface WordFilter {
  cefr: Cefr[];
  eiken: Eiken[];
  toeic: boolean;
  toefl: boolean;
  /** "any": word matches if it matches at least one checked criterion; "all": every checked group */
  mode: "any" | "all";
  /** optional Zipf frequency range */
  zipfMin?: number;
  zipfMax?: number;
}

// ---------- persisted learning state ----------

export interface Cycle {
  id: string;
  name: string;
  createdAt: string;
  filter: WordFilter;
  size: number;
  reviewRatio: number;
  /** the fixed test range of this cycle */
  wordIds: string[];
  /** ids carried over from the previous cycle (subset of wordIds) */
  carriedIds: string[];
  /** ids chosen as review of earlier cycles (subset of wordIds) */
  reviewIds: string[];
  previousCycleId?: string;
  archived?: boolean;
}

export type AttemptMode = "online" | "paper";

export interface Attempt {
  id: string;
  cycleId: string | null;
  mode: AttemptMode;
  createdAt: string;
  completedAt?: string;
  /** question order (word ids) */
  order: string[];
  /** typed answers (online mode) */
  answers?: Record<string, string>;
  /** word ids skipped in the online test (graded as wrong) */
  skipped?: string[];
  /** graded result per word id */
  results?: Record<string, boolean>;
  label?: string;
}

export interface Settings {
  geminiApiKey: string;
  ttsModel: string;
  ttsVoice: string;
  ttsAccent: "us" | "uk";
  /** max senses shown per question */
  sensesPerQuestion: number;
  showFirstLetterHint: boolean;
  showLengthHint: boolean;
  showCollocations: boolean;
  showExamples: boolean;
  /** how "wrong in this cycle" is decided for carry-over */
  carryOverRule: "any-wrong" | "last-wrong";
}

export interface AppState {
  version: 1;
  settings: Settings;
  cycles: Cycle[];
  attempts: Attempt[];
}

export const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: "",
  ttsModel: "gemini-3.8-flash-tts",
  ttsVoice: "Kore",
  ttsAccent: "us",
  sensesPerQuestion: 3,
  showFirstLetterHint: true,
  showLengthHint: true,
  showCollocations: true,
  showExamples: true,
  carryOverRule: "any-wrong",
};

export const DEFAULT_FILTER: WordFilter = { cefr: [], eiken: [], toeic: false, toefl: false, mode: "any" };
