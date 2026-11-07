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
  cefr: Cefr;
  /** the list the CEFR level was taken from (see LEVEL_SOURCES) */
  src: LevelSource;
  /** level given by every list that contains the word */
  levels: Partial<Record<LevelSource, Cefr>>;
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

/** CEFR word lists, most trusted first. A word's level comes from the first list that has it. */
export const LEVEL_SOURCES = ["cefrj", "octanove", "oxford", "efllex", "kelly"] as const;
export type LevelSource = (typeof LEVEL_SOURCES)[number];
export const SOURCE_LABEL: Record<LevelSource, string> = {
  cefrj: "CEFR-J",
  octanove: "Octanove",
  oxford: "Oxford 5000",
  efllex: "EFLLex",
  kelly: "Kelly",
};

// ---------- word filter ----------

export interface WordFilter {
  cefr: Cefr[];
  /** only words whose level comes from these lists (empty = all lists) */
  sources?: LevelSource[];
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
  /** browser speech-synthesis voice name used without an API key ("" = pick the best English voice) */
  browserVoice: string;
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
  browserVoice: "",
  sensesPerQuestion: 3,
  showFirstLetterHint: true,
  showLengthHint: true,
  showCollocations: true,
  showExamples: true,
  carryOverRule: "any-wrong",
};

export const DEFAULT_FILTER: WordFilter = { cefr: [], sources: [] };
