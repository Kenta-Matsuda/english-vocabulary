import { useEffect, useMemo, useState } from "preact/hooks";
import { alertless, Entry, FilterEditor, Page, SpeakButton, Stat, Tags } from "../components";
import { englishVoices } from "../tts";
import { completedAttempts, cycleSummary, describeFilter, filterWords, fmtDate, wordStats } from "../logic";
import { exportJson, importJson, loadDataset, update, useAppState, wordById, words } from "../store";
import type { Settings, WordFilter } from "../types";
import { DEFAULT_FILTER, LEVEL_SOURCES, SOURCE_LABEL } from "../types";

export function HomePage() {
  const state = useAppState();
  const current = state.cycles.filter((c) => !c.archived).at(-1);
  const recent = completedAttempts(state).slice(-6).reverse();
  const stats = wordStats(state);
  const mastered = [...stats.values()].filter((s) => s.lastResult).length;
  const sum = current ? cycleSummary(state, current) : [];
  return (
    <Page eyebrow="English in English" title="Good to see you.">
      <p class="lead">Recall each word from its English definitions, synonyms, phrases and examples — no translations.</p>
      <div class="stats" style={{ margin: "22px 0" }}>
        <Stat label="Words studied" value={stats.size.toLocaleString()} />
        <Stat label="Correct last time" value={mastered.toLocaleString()} />
        <Stat label="Tests taken" value={completedAttempts(state).length} />
        <Stat label="Cycles" value={state.cycles.length} />
      </div>
      <div class="cards">
        <div class="card hero-card">
          <div class="card-k">Current cycle</div>
          {current ? (
            <>
              <h3>{current.name}</h3>
              <p class="small muted grow">
                {current.wordIds.length} words · {describeFilter(current.filter)}
                <br />
                Scores: {sum.map((s) => `${Math.round((100 * s.correct) / s.total)}%`).join(" → ") || "no tests yet"}
              </p>
              <div><a class="btn primary" href={`#/cycle/${current.id}`}>Open cycle</a></div>
            </>
          ) : (
            <>
              <h3>Start your first cycle</h3>
              <p class="small muted grow">Pick CEFR levels and a number of words.</p>
              <div><a class="btn primary" href="#/cycles/new">Create a cycle</a></div>
            </>
          )}
        </div>
        <div class="card">
          <div class="card-k">Practice</div>
          <h3>Quick test</h3>
          <p class="small muted grow">10, 100 or any number of random words from a range.</p>
          <div><a class="btn" href="#/quick">Start a quick test</a></div>
        </div>
        <div class="card">
          <div class="card-k">Recent</div>
          <h3>Latest results</h3>
          {recent.length ? (
            <table class="mini grow">
              <tbody>
                {recent.map((a) => {
                  const r = Object.values(a.results!);
                  return (
                    <tr key={a.id}>
                      <td><a href={`#/grade/${a.id}`}>{fmtDate(a.completedAt).slice(5, 10)}</a></td>
                      <td class="muted">{a.mode === "paper" ? "Paper" : "Online"}</td>
                      <td style={{ textAlign: "right" }}><b>{r.filter(Boolean).length}</b><span class="muted"> / {r.length}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p class="small muted grow">No results yet.</p>
          )}
        </div>
      </div>
    </Page>
  );
}

export function WordsPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<WordFilter>(DEFAULT_FILTER);
  const [limit, setLimit] = useState(40);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return filterWords(words(), filter).filter((w) => !ql || w.id.startsWith(ql));
  }, [q, filter]);
  return (
    <Page eyebrow="Dictionary" title="Words">
      <div class="panel" style={{ padding: "16px 20px", marginBottom: "18px", display: "grid", gap: "12px" }}>
        <input class="search" placeholder="Search words…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <FilterEditor value={filter} onChange={setFilter} />
      </div>
      <p class="small muted">{list.length.toLocaleString()} words</p>
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
    <Page eyebrow="Word" title={w.w} narrow>
      <Entry w={w} />
      <p class="small muted">
        CEFR {w.cefr} from {SOURCE_LABEL[w.src]} · listed in{" "}
        {LEVEL_SOURCES.filter((s) => w.levels[s]).map((s) => `${SOURCE_LABEL[s]} ${w.levels[s]}`).join(", ")} · frequency (Zipf) {w.zipf}
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
    <Page eyebrow="Progress" title="History">
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
    <Page eyebrow="Preferences" title="Settings">
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
        <label class="row">
          <span>Browser voice</span>
          <BrowserVoicePicker value={s.browserVoice} onChange={(v) => set("browserVoice", v)} />
        </label>
        <p class="small muted">
          Browser voice is used only when no API key is set. The key is stored only in this browser (IndexedDB) and sent only to generativelanguage.googleapis.com. Audio is requested every time (no caching).
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
    </Page>
  );
}

function BrowserVoicePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => void englishVoices().then(setVoices), []);
  return (
    <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">Auto (best English voice)</option>
        {voices.map((v) => (
          <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
        ))}
      </select>
      <SpeakButton text="Hello, this is a pronunciation test." small />
    </span>
  );
}
