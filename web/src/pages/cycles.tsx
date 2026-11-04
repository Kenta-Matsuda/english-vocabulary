import { useMemo, useState } from "preact/hooks";
import { CountPicker, FilterEditor, Page } from "../components";
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

export function CyclesPage() {
  const state = useAppState();
  const cycles = [...state.cycles].reverse();
  return (
    <Page title="Cycles" actions={<a class="btn primary" href="#/cycles/new">+ New cycle</a>}>
      <p class="muted">
        A cycle is a fixed range of words. Every test in the cycle uses the same words in a new random order.
        Words you miss are carried over to the next cycle.
      </p>
      {!cycles.length && <p>No cycles yet.</p>}
      <table class="list">
        <thead>
          <tr><th>Name</th><th>Created</th><th>Words</th><th>Range</th><th>Tests</th></tr>
        </thead>
        <tbody>
          {cycles.map((c) => {
            const sum = cycleSummary(state, c);
            return (
              <tr key={c.id} class={c.archived ? "muted" : ""}>
                <td><a href={`#/cycle/${c.id}`}>{c.name}</a></td>
                <td>{c.createdAt.slice(0, 10)}</td>
                <td>{c.wordIds.length}</td>
                <td>{describeFilter(c.filter)}</td>
                <td>{sum.map((s) => `${s.correct}/${s.total}`).join(" → ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const [name, setName] = useState(`Cycle ${state.cycles.length + 1} (${new Date().toISOString().slice(0, 10)})`);
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
    <Page title="New cycle">
      <div class="form">
        <label class="row">
          <span>Name</span>
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="row">
          <span>Previous cycle</span>
          <select value={prev} onChange={(e) => setPrev((e.target as HTMLSelectElement).value)}>
            <option value="">(none — start fresh)</option>
            {[...state.cycles].reverse().map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {wrongInCycle(state, c, state.settings.carryOverRule).length} missed
              </option>
            ))}
          </select>
        </label>
        <div class="row">
          <span>Word range</span>
          <div>
            <FilterEditor value={filter} onChange={setFilter} />
            <div class="muted">{poolSize} testable words match.</div>
          </div>
        </div>
        <div class="row">
          <span>Words in cycle</span>
          <CountPicker value={size} onChange={setSize} />
        </div>
        <label class="row">
          <span>Review ratio</span>
          <span>
            <input type="range" min={0} max={100} step={5} value={ratio * 100} onInput={(e) => setRatio(Number((e.target as HTMLInputElement).value) / 100)} />{" "}
            {Math.round(ratio * 100)}% review / {100 - Math.round(ratio * 100)}% new <span class="muted">(after carry-over)</span>
          </span>
        </label>
        <div class="plan">
          <div>Carried over (missed last cycle): <b>{plan.carried.length}</b></div>
          <div>Review (studied before, random): <b>{plan.review.length}</b> <span class="muted">of {plan.available.review} available</span></div>
          <div>New (never studied, random): <b>{plan.fresh.length}</b> <span class="muted">of {plan.available.fresh} available</span></div>
          <div>Total: <b>{total}</b></div>
          {total < size && <div class="warn">Not enough words in this range to fill {size}.</div>}
          <button onClick={() => setSeed(seed + 1)}>Re-roll random words</button>
        </div>
        <button class="primary" disabled={!total} onClick={create}>Create cycle</button>
      </div>
    </Page>
  );
}

export function CyclePage({ id }: { id: string }) {
  const state = useAppState();
  const c = state.cycles.find((x) => x.id === id);
  if (!c) return <Page title="Not found">Cycle not found.</Page>;
  const atts = state.attempts.filter((a) => a.cycleId === c.id);
  const summary = new Map(cycleSummary(state, c).map((s) => [s.attempt.id, s]));
  const missed = wrongInCycle(state, c, state.settings.carryOverRule);

  const startOnline = () => go(`#/test/${newAttempt(c.id, c.wordIds, "online").id}`);
  const startPaper = () => go(`#/print/test/${newAttempt(c.id, c.wordIds, "paper").id}`);

  return (
    <Page
      title={c.name}
      actions={
        <>
          <a class="btn" href={`#/print/list/${c.id}`}>🖨 Word list</a>
          <button onClick={startPaper}>🖨 New paper test</button>
          <button class="primary" onClick={startOnline}>Start online test</button>
        </>
      }
    >
      <p>
        {c.wordIds.length} words · {describeFilter(c.filter)} · carried over {c.carriedIds.length} · review {c.reviewIds.length} · new{" "}
        {c.wordIds.length - c.carriedIds.length - c.reviewIds.length}
      </p>
      <h2>Tests</h2>
      {!atts.length && <p class="muted">No tests yet. Each test shuffles the same {c.wordIds.length} words.</p>}
      <table class="list">
        <thead>
          <tr><th>#</th><th>Created</th><th>Mode</th><th>Score</th><th></th></tr>
        </thead>
        <tbody>
          {atts.map((a, i) => {
            const s = summary.get(a.id);
            return (
              <tr key={a.id}>
                <td>{i + 1}</td>
                <td>{fmtDate(a.createdAt)}</td>
                <td>{a.mode}</td>
                <td>{s ? `${s.correct}/${s.total} (${Math.round((100 * s.correct) / s.total)}%)` : "—"}</td>
                <td class="actions">
                  {a.mode === "paper" && <a href={`#/print/test/${a.id}`}>print</a>}
                  {a.mode === "online" && !a.results && <a href={`#/test/${a.id}`}>continue</a>}
                  <a href={`#/grade/${a.id}`}>{a.results ? "review / edit" : a.mode === "paper" ? "enter ○×" : ""}</a>
                  <DeleteAttempt id={a.id} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h2>Next cycle</h2>
      <p>
        Currently <b>{missed.length}</b> word(s) would be carried over (
        {state.settings.carryOverRule === "any-wrong" ? "missed in any test" : "missed in the latest test"} — change in Settings).
      </p>
      {missed.length > 0 && <p class="small">{missed.map((m) => wordById(m)?.w ?? m).join(", ")}</p>}
      <a class="btn primary" href={`#/cycles/new?prev=${c.id}`}>Start next cycle →</a>
      <h2>Words</h2>
      <p class="small">
        {[...c.wordIds]
          .map((i) => wordById(i)?.w ?? i)
          .sort()
          .join(", ")}
      </p>
      <p>
        <button
          class="danger"
          onClick={() => {
            if (!confirmInline(`delete-${c.id}`)) return;
            update((s) => {
              s.cycles = s.cycles.filter((x) => x.id !== c.id);
              s.attempts = s.attempts.filter((a) => a.cycleId !== c.id);
            });
            go("#/cycles");
          }}
        >
          Delete cycle (click twice)
        </button>
      </p>
    </Page>
  );
}

/** Two-click confirmation without blocking browser dialogs. */
const armed = new Map<string, number>();
export function confirmInline(key: string): boolean {
  const t = armed.get(key);
  if (t && Date.now() - t < 4000) {
    armed.delete(key);
    return true;
  }
  armed.set(key, Date.now());
  return false;
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
      {armedNow ? "confirm delete" : "delete"}
    </a>
  );
}

export function QuickTestPage() {
  const [filter, setFilter] = useState<WordFilter>(DEFAULT_FILTER);
  const [n, setN] = useState(10);
  const pool = useMemo(() => filterWords(words(), filter), [filter]);
  const start = (mode: AttemptMode) => {
    const ids = shuffle(pool.map((w) => w.id)).slice(0, n);
    const a = newAttempt(null, ids, mode, `Quick test (${describeFilter(filter)})`);
    go(mode === "online" ? `#/test/${a.id}` : `#/print/test/${a.id}`);
  };
  return (
    <Page title="Quick test">
      <p class="muted">Random words from a range, outside of any cycle. Results are still saved to your history.</p>
      <div class="form">
        <div class="row">
          <span>Range</span>
          <div>
            <FilterEditor value={filter} onChange={setFilter} />
            <div class="muted">{pool.length} testable words match.</div>
          </div>
        </div>
        <div class="row">
          <span>Questions</span>
          <CountPicker value={n} onChange={setN} max={pool.length} />
        </div>
        <div class="row">
          <span></span>
          <span>
            <button class="primary" disabled={!pool.length} onClick={() => start("online")}>Start online</button>{" "}
            <button disabled={!pool.length} onClick={() => start("paper")}>🖨 Print paper test</button>
          </span>
        </div>
      </div>
    </Page>
  );
}
