import { useMemo, useState } from "preact/hooks";
import { alertless, Entry, FilterEditor, Page, Tags } from "../components";
import { completedAttempts, cycleSummary, describeFilter, filterWords, fmtDate, wordStats } from "../logic";
import { exportJson, importJson, loadDataset, update, useAppState, wordById, words } from "../store";
import type { Settings, WordFilter } from "../types";
import { DEFAULT_FILTER } from "../types";

export function HomePage() {
  const state = useAppState();
  const current = state.cycles.filter((c) => !c.archived).at(-1);
  const recent = completedAttempts(state).slice(-5).reverse();
  return (
    <Page title="Vocabulary Trainer">
      <p class="muted">Learn English words in English: guess the word from its definitions, synonyms, phrases and examples.</p>
      <div class="cards">
        <div class="card">
          <h2>Current cycle</h2>
          {current ? (
            <>
              <p>
                <a href={`#/cycle/${current.id}`}>{current.name}</a> — {current.wordIds.length} words
              </p>
              <p class="small">
                Tests: {cycleSummary(state, current).map((s) => `${s.correct}/${s.total}`).join(" → ") || "none yet"}
              </p>
              <a class="btn primary" href={`#/cycle/${current.id}`}>Open</a>
            </>
          ) : (
            <a class="btn primary" href="#/cycles/new">Create your first cycle</a>
          )}
        </div>
        <div class="card">
          <h2>Quick test</h2>
          <p class="small">Random 10 / 100 / any number of words from a range.</p>
          <a class="btn" href="#/quick">Start</a>
        </div>
        <div class="card">
          <h2>Recent results</h2>
          {recent.length ? (
            <ul class="small">
              {recent.map((a) => {
                const r = Object.values(a.results!);
                return (
                  <li key={a.id}>
                    <a href={`#/grade/${a.id}`}>{a.completedAt?.slice(0, 10)}</a> {a.mode} — {r.filter(Boolean).length}/{r.length}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="small muted">No results yet.</p>
          )}
        </div>
      </div>
    </Page>
  );
}

export function WordsPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<WordFilter>(DEFAULT_FILTER);
  const [limit, setLimit] = useState(50);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return filterWords(words(), filter).filter((w) => !ql || w.id.startsWith(ql));
  }, [q, filter]);
  return (
    <Page title="Words">
      <input class="search" placeholder="Search (prefix)…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <FilterEditor value={filter} onChange={setFilter} />
      <p class="muted">{list.length} words</p>
      {list.slice(0, limit).map((w) => (
        <Entry key={w.id} w={w} compact />
      ))}
      {list.length > limit && <button onClick={() => setLimit(limit + 100)}>Show more</button>}
    </Page>
  );
}

export function WordPage({ id }: { id: string }) {
  const state = useAppState();
  const w = wordById(id);
  if (!w) return <Page title="Not found">Word not found.</Page>;
  const st = wordStats(state).get(id);
  return (
    <Page title={w.w}>
      <Entry w={w} />
      <p class="small muted">
        Lists: {w.lists.join(", ")} · frequency (Zipf) {w.zipf}
        {st && ` · tested ${st.tested}×, correct ${st.correct}×`}
      </p>
    </Page>
  );
}

export function HistoryPage() {
  const state = useAppState();
  const atts = completedAttempts(state).reverse();
  const stats = wordStats(state);
  const hardest = [...stats.entries()]
    .filter(([, s]) => s.tested - s.correct > 0)
    .sort((a, b) => b[1].tested - b[1].correct - (a[1].tested - a[1].correct) || a[1].correct / a[1].tested - b[1].correct / b[1].tested)
    .slice(0, 50);
  return (
    <Page title="History">
      <p>
        {atts.length} tests · {stats.size} different words tested · {[...stats.values()].filter((s) => s.lastResult).length} answered correctly last time
      </p>
      <h2>Tests</h2>
      <table class="list">
        <thead>
          <tr><th>Date</th><th>Cycle / label</th><th>Mode</th><th>Score</th></tr>
        </thead>
        <tbody>
          {atts.map((a) => {
            const r = Object.values(a.results!);
            const c = state.cycles.find((x) => x.id === a.cycleId);
            return (
              <tr key={a.id}>
                <td><a href={`#/grade/${a.id}`}>{fmtDate(a.completedAt)}</a></td>
                <td>{c ? <a href={`#/cycle/${c.id}`}>{c.name}</a> : a.label}</td>
                <td>{a.mode}</td>
                <td>{r.filter(Boolean).length}/{r.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>Most missed words</h2>
      <table class="list">
        <thead>
          <tr><th>Word</th><th>Missed</th><th>Tested</th><th>Last</th><th></th></tr>
        </thead>
        <tbody>
          {hardest.map(([id, s]) => {
            const w = wordById(id);
            return (
              <tr key={id}>
                <td><a href={`#/word/${encodeURIComponent(id)}`}>{w?.w ?? id}</a></td>
                <td>{s.tested - s.correct}</td>
                <td>{s.tested}</td>
                <td>{s.lastResult ? "○" : "×"}</td>
                <td>{w && <Tags w={w} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Page>
  );
}

export function SettingsPage() {
  const state = useAppState();
  const s = state.settings;
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof loadDataset>>["meta"] | null>(null);
  const [withKey, setWithKey] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update((st) => void (st.settings[k] = v));
  if (!meta) void loadDataset().then((d) => setMeta(d.meta));

  const download = () => {
    const blob = new Blob([exportJson(withKey)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vocab-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async (file: File, mode: "replace" | "merge") => {
    try {
      const r = importJson(await file.text(), mode);
      alertless(`Imported ${r.cycles} cycles and ${r.attempts} tests (${mode}).`);
    } catch (e) {
      alertless("Import failed: " + (e as Error).message);
    }
  };

  return (
    <Page title="Settings">
      <h2>Pronunciation (Gemini TTS, bring your own key)</h2>
      <div class="form">
        <label class="row">
          <span>Gemini API key</span>
          <input type="password" value={s.geminiApiKey} placeholder="Leave empty to use the browser's built-in voice" onInput={(e) => set("geminiApiKey", (e.target as HTMLInputElement).value.trim())} />
        </label>
        <label class="row">
          <span>Model</span>
          <input value={s.ttsModel} onInput={(e) => set("ttsModel", (e.target as HTMLInputElement).value.trim())} />
        </label>
        <label class="row">
          <span>Voice</span>
          <input value={s.ttsVoice} onInput={(e) => set("ttsVoice", (e.target as HTMLInputElement).value.trim())} />
        </label>
        <label class="row">
          <span>Accent</span>
          <select value={s.ttsAccent} onChange={(e) => set("ttsAccent", (e.target as HTMLSelectElement).value as "us" | "uk")}>
            <option value="us">American</option>
            <option value="uk">British</option>
          </select>
        </label>
        <p class="small muted">
          The key is stored only in this browser (IndexedDB) and sent only to generativelanguage.googleapis.com. Audio is requested every time (no caching).
        </p>
      </div>

      <h2>Questions</h2>
      <div class="form">
        <label class="row">
          <span>Definitions per question</span>
          <input type="number" min={1} max={5} value={s.sensesPerQuestion} onInput={(e) => set("sensesPerQuestion", Number((e.target as HTMLInputElement).value) || 1)} />
        </label>
        <label class="row"><span>Hint: first letter</span><input type="checkbox" checked={s.showFirstLetterHint} onChange={() => set("showFirstLetterHint", !s.showFirstLetterHint)} /></label>
        <label class="row"><span>Hint: number of letters</span><input type="checkbox" checked={s.showLengthHint} onChange={() => set("showLengthHint", !s.showLengthHint)} /></label>
        <label class="row"><span>Show phrases (collocations)</span><input type="checkbox" checked={s.showCollocations} onChange={() => set("showCollocations", !s.showCollocations)} /></label>
        <label class="row"><span>Show an example sentence</span><input type="checkbox" checked={s.showExamples} onChange={() => set("showExamples", !s.showExamples)} /></label>
        <label class="row">
          <span>Carry over to next cycle</span>
          <select value={s.carryOverRule} onChange={(e) => set("carryOverRule", (e.target as HTMLSelectElement).value as Settings["carryOverRule"])}>
            <option value="any-wrong">words missed in any test of the cycle</option>
            <option value="last-wrong">words missed in the latest test only</option>
          </select>
        </label>
      </div>

      <h2>Backup (import / export)</h2>
      <div class="form">
        <div class="row">
          <span>Export</span>
          <span>
            <button onClick={download}>Download history (.json)</button>{" "}
            <label class="small"><input type="checkbox" checked={withKey} onChange={() => setWithKey(!withKey)} /> include API key</label>
          </span>
        </div>
        <div class="row">
          <span>Import (merge)</span>
          <input type="file" accept="application/json,.json" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void upload(f, "merge"); }} />
        </div>
        <div class="row">
          <span>Import (replace all)</span>
          <input type="file" accept="application/json,.json" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void upload(f, "replace"); }} />
        </div>
        <p class="small muted">History lives only in this browser. Export regularly, and import on another browser/PC to continue there.</p>
      </div>

      <h2>Dataset</h2>
      {meta && (
        <div class="small">
          <p>Built {meta.built}. {meta.stats.total} words, {meta.stats.with_senses} with definitions.</p>
          <ul>{Object.entries(meta.sources).map(([k, v]) => <li key={k}><b>{k}</b>: {v}</li>)}</ul>
        </div>
      )}
      <p class="small muted">Current filter syntax example: {describeFilter({ ...DEFAULT_FILTER, cefr: ["B2", "C1"], eiken: ["pre1"] })}</p>
    </Page>
  );
}
