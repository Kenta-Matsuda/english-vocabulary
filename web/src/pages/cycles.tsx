import { useMemo, useState } from "preact/hooks";
import { CountPicker, FilterEditor, Ipa, Page, SpeakButton, Stat } from "../components";
import { cycleSummary, describeFilter, filterWords, fmtDate, planCycle, shuffle, uid, wrongInCycle } from "../logic";
import { update, useAppState, wordById, words } from "../store";
import type { Attempt, AttemptMode, Cycle, WordFilter } from "../types";
import { DEFAULT_FILTER } from "../types";
import { go } from "../router";

export function newAttempt(cycleId: string | null, ids: string[], mode: AttemptMode, label?: string): Attempt {
  const a: Attempt = { id: uid(), cycleId, mode, createdAt: new Date().toISOString(), order: shuffle(ids), label };
  update((s) => void s.attempts.push(a));
  return a;
}

const pct = (c: number, t: number) => (t ? Math.round((100 * c) / t) : 0);

export function CyclesPage() {
  const state = useAppState();
  const cycles = [...state.cycles].reverse();
  return (
    <Page eyebrow="Study plan" title="Cycles" actions={<a class="btn primary" href="#/cycles/new">New cycle</a>}>
      <p class="lead">
        A cycle fixes a set of words. Every test in the cycle uses the same words in a new random order, and the words
        you miss are carried over to the next cycle.
      </p>
      {!cycles.length ? (
        <div class="empty">No cycles yet. <a href="#/cycles/new">Create the first one →</a></div>
      ) : (
        <table class="list">
          <thead>
            <tr><th>Cycle</th><th>Created</th><th>Words</th><th>Range</th><th>Scores</th></tr>
          </thead>
          <tbody>
            {cycles.map((c) => {
              const sum = cycleSummary(state, c);
              return (
                <tr key={c.id} class={c.archived ? "muted" : ""}>
                  <td><a href={`#/cycle/${c.id}`}><b>{c.name}</b></a></td>
                  <td>{c.createdAt.slice(0, 10)}</td>
                  <td>{c.wordIds.length}</td>
                  <td>{describeFilter(c.filter)}</td>
                  <td>{sum.map((s) => `${pct(s.correct, s.total)}%`).join(" → ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Page>
  );
}

export function NewCyclePage({ prevId }: { prevId?: string }) {
  const state = useAppState();
  const prevDefault = prevId ? state.cycles.find((c) => c.id === prevId) : state.cycles.filter((c) => !c.archived).at(-1);
  const [prev, setPrev] = useState<string>(prevDefault?.id ?? "");
  const previous = state.cycles.find((c) => c.id === prev);
  const [filter, setFilter] = useState<WordFilter>(previous?.filter ?? DEFAULT_FILTER);
  const [size, setSize] = useState(previous?.size ?? 100);
  const [ratio, setRatio] = useState(previous?.reviewRatio ?? 0.2);
  const [name, setName] = useState(`Cycle ${state.cycles.length + 1}`);
  const [seed, setSeed] = useState(0);

  const all = words();
  const poolSize = useMemo(() => filterWords(all, filter).length, [all, filter]);
  const plan = useMemo(() => planCycle(state, all, filter, size, ratio, previous), [state, all, filter, size, ratio, previous, seed]);
  const total = plan.carried.length + plan.review.length + plan.fresh.length;

  const create = () => {
    const c: Cycle = {
      id: uid(),
      name,
      createdAt: new Date().toISOString(),
      filter,
      size,
      reviewRatio: ratio,
      wordIds: [...plan.carried, ...plan.review, ...plan.fresh],
      carriedIds: plan.carried,
      reviewIds: plan.review,
      previousCycleId: previous?.id,
    };
    update((s) => {
      if (previous) {
        const p = s.cycles.find((x) => x.id === previous.id);
        if (p) p.archived = true;
      }
      s.cycles.push(c);
    });
    go(`#/cycle/${c.id}`);
  };

  return (
    <Page eyebrow="Study plan" title="New cycle">
      <div class="form">
        <label class="row">
          <span>Name</span>
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="row">
          <span>Continue from</span>
          <select value={prev} onChange={(e) => setPrev((e.target as HTMLSelectElement).value)}>
            <option value="">— Start fresh —</option>
            {[...state.cycles].reverse().map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({wrongInCycle(state, c, state.settings.carryOverRule).length} missed)
              </option>
            ))}
          </select>
        </label>
        <div class="row top">
          <span>Word range</span>
          <div>
            <FilterEditor value={filter} onChange={setFilter} />
            <div class="small muted" style={{ marginTop: "8px" }}>{poolSize.toLocaleString()} words in range</div>
          </div>
        </div>
        <div class="row">
          <span>Words per cycle</span>
          <CountPicker value={size} onChange={setSize} />
        </div>
        <label class="row">
          <span>Review / new</span>
          <span style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <input type="range" min={0} max={100} step={5} value={ratio * 100} style={{ flex: 1, maxWidth: "280px" }} onInput={(e) => setRatio(Number((e.target as HTMLInputElement).value) / 100)} />
            <span class="small">{Math.round(ratio * 100)}% review · {100 - Math.round(ratio * 100)}% new</span>
          </span>
        </label>
        <div class="row top">
          <span>Preview</span>
          <div>
            <div class="plan">
              <Stat label="Carried over" value={plan.carried.length} sub="missed last cycle" />
              <Stat label="Review" value={plan.review.length} sub={`of ${plan.available.review} studied`} />
              <Stat label="New" value={plan.fresh.length} sub={`of ${plan.available.fresh.toLocaleString()} unseen`} />
              <Stat label="Total" value={total} sub={total < size ? <span class="warn">range too small</span> : "words"} />
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
              <button class="primary lg" disabled={!total} onClick={create}>Create cycle</button>
              <button class="ghost" onClick={() => setSeed(seed + 1)}>Shuffle selection</button>
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

export function CyclePage({ id }: { id: string }) {
  const state = useAppState();
  const [armed, setArmed] = useState(false);
  const c = state.cycles.find((x) => x.id === id);
  if (!c) return <Page title="Not found">Cycle not found.</Page>;
  const atts = state.attempts.filter((a) => a.cycleId === c.id);
  const summary = new Map(cycleSummary(state, c).map((s) => [s.attempt.id, s]));
  const missed = wrongInCycle(state, c, state.settings.carryOverRule);
  const fresh = c.wordIds.length - c.carriedIds.length - c.reviewIds.length;

  const startOnline = () => go(`#/test/${newAttempt(c.id, c.wordIds, "online").id}`);
  const startPaper = () => go(`#/print/test/${newAttempt(c.id, c.wordIds, "paper").id}`);

  return (
    <Page eyebrow={`Cycle · ${describeFilter(c.filter)}`} title={c.name}>
      <div class="stats">
        <Stat label="Words" value={c.wordIds.length} />
        <Stat label="Carried over" value={c.carriedIds.length} />
        <Stat label="Review" value={c.reviewIds.length} />
        <Stat label="New" value={fresh} />
        <Stat label="Tests taken" value={summary.size} />
      </div>

      <div class="cards" style={{ marginTop: "20px" }}>
        <div class="card">
          <div class="card-k">Step 1 · Memorise</div>
          <h3>Study sheet</h3>
          <p class="small muted grow">Every word with pronunciation, all definitions, synonyms, phrases and examples.</p>
          <div><a class="btn" href={`#/print/list/${c.id}`}>Open study sheet</a></div>
        </div>
        <div class="card">
          <div class="card-k">Step 2 · Test on paper</div>
          <h3>Test sheet</h3>
          <p class="small muted grow">A new random order each time, with a separate answer key. Enter ○× afterwards.</p>
          <div><button onClick={startPaper}>Create test sheet</button></div>
        </div>
        <div class="card">
          <div class="card-k">Or · Test online</div>
          <h3>Online test</h3>
          <p class="small muted grow">Type each answer; graded automatically.</p>
          <div><button class="primary" onClick={startOnline}>Start online test</button></div>
        </div>
      </div>

      <h2>Tests in this cycle</h2>
      {!atts.length ? (
        <div class="empty">No tests yet.</div>
      ) : (
        <table class="list">
          <thead>
            <tr><th>No.</th><th>Created</th><th>Mode</th><th>Score</th><th></th></tr>
          </thead>
          <tbody>
            {atts.map((a, i) => {
              const s = summary.get(a.id);
              return (
                <tr key={a.id}>
                  <td class="num">{i + 1}</td>
                  <td>{fmtDate(a.createdAt)}</td>
                  <td>{a.mode === "paper" ? "Paper" : "Online"}</td>
                  <td>{s ? <b>{s.correct} / {s.total} <span class="muted">({pct(s.correct, s.total)}%)</span></b> : <span class="muted">—</span>}</td>
                  <td class="actions">
                    {a.mode === "paper" && <a href={`#/print/test/${a.id}`}>Print</a>}
                    {a.mode === "online" && !a.results && <a href={`#/test/${a.id}`}>Continue</a>}
                    {(a.results || a.mode === "paper") && <a href={`#/grade/${a.id}`}>{a.results ? "Review" : "Enter ○×"}</a>}
                    <DeleteAttempt id={a.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Next cycle</h2>
      <div class="panel" style={{ padding: "18px 22px" }}>
        <p>
          <b>{missed.length}</b> word{missed.length === 1 ? "" : "s"} will be carried over{" "}
          <span class="muted small">({state.settings.carryOverRule === "any-wrong" ? "missed in any test" : "missed in the latest test"} — see Settings)</span>
        </p>
        {missed.length > 0 && <p class="small" style={{ fontFamily: "var(--serif)" }}>{missed.map((m) => wordById(m)?.w ?? m).join(" · ")}</p>}
        <p style={{ marginTop: "12px" }}><a class="btn primary" href={`#/cycles/new?prev=${c.id}`}>Start next cycle →</a></p>
      </div>

      <h2>Words in this cycle</h2>
      <p class="small muted">Click the speaker icon to hear a word.</p>
      <div class="wordcloud">
        {c.wordIds
          .map((i) => ({ id: i, word: wordById(i) }))
          .sort((a, b) => (a.word?.w ?? a.id).localeCompare(b.word?.w ?? b.id))
          .map(({ id, word }) => (
            <span key={id} class="wc-item">
              <SpeakButton text={word?.w ?? id} small />
              <span class="wc-w">{word?.w ?? id}</span>
              {word && <Ipa w={word} one />}
            </span>
          ))}
      </div>

      <p style={{ marginTop: "40px" }}>
        <button
          class="danger"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              setTimeout(() => setArmed(false), 4000);
              return;
            }
            update((s) => {
              s.cycles = s.cycles.filter((x) => x.id !== c.id);
              s.attempts = s.attempts.filter((a) => a.cycleId !== c.id);
            });
            go("#/cycles");
          }}
        >
          {armed ? "Click again to delete this cycle and its tests" : "Delete cycle"}
        </button>
      </p>
    </Page>
  );
}

function DeleteAttempt({ id }: { id: string }) {
  const [armedNow, setArmed] = useState(false);
  return (
    <a
      class="danger-link"
      href="javascript:void 0"
      onClick={() => {
        if (!armedNow) {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
          return;
        }
        update((s) => void (s.attempts = s.attempts.filter((a) => a.id !== id)));
      }}
    >
      {armedNow ? "Confirm delete" : "Delete"}
    </a>
  );
}

export function QuickTestPage() {
  const [filter, setFilter] = useState<WordFilter>(DEFAULT_FILTER);
  const [n, setN] = useState(10);
  const pool = useMemo(() => filterWords(words(), filter), [filter]);
  const start = (mode: AttemptMode) => {
    const ids = shuffle(pool.map((w) => w.id)).slice(0, n);
    const a = newAttempt(null, ids, mode, `Quick test · ${describeFilter(filter)}`);
    go(mode === "online" ? `#/test/${a.id}` : `#/print/test/${a.id}`);
  };
  return (
    <Page eyebrow="Practice" title="Quick test">
      <p class="lead">Random words from any range, outside of a cycle. Results are saved to your history.</p>
      <div class="form">
        <div class="row top">
          <span>Word range</span>
          <div>
            <FilterEditor value={filter} onChange={setFilter} />
            <div class="small muted" style={{ marginTop: "8px" }}>{pool.length.toLocaleString()} words in range</div>
          </div>
        </div>
        <div class="row">
          <span>Questions</span>
          <CountPicker value={n} onChange={setN} max={pool.length} />
        </div>
        <div class="row">
          <span></span>
          <span style={{ display: "flex", gap: "8px" }}>
            <button class="primary lg" disabled={!pool.length} onClick={() => start("online")}>Start online</button>
            <button class="lg" disabled={!pool.length} onClick={() => start("paper")}>Create test sheet</button>
          </span>
        </div>
      </div>
    </Page>
  );
}
