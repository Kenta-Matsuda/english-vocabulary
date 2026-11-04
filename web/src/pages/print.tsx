import { useState } from "preact/hooks";
import { Entry, Ipa, Masked, Page, Question } from "../components";
import { useAppState, wordById } from "../store";
import type { Word } from "../types";

function PrintBar({ children }: { children?: preact.ComponentChildren }) {
  return (
    <div class="print-bar no-print">
      <button class="primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      {children}
      <span class="muted small">Tip: in the print dialog choose “Save as PDF” and turn off headers/footers.</span>
    </div>
  );
}

/** Study word list for a cycle (alphabetical). */
export function PrintListPage({ id }: { id: string }) {
  const state = useAppState();
  const c = state.cycles.find((x) => x.id === id);
  if (!c) return <Page title="Not found">Cycle not found.</Page>;
  const ws = c.wordIds.map((i) => wordById(i)).filter((w): w is Word => !!w).sort((a, b) => a.w.localeCompare(b.w));
  return (
    <div class="printable">
      <PrintBar>
        <a class="btn" href={`#/cycle/${c.id}`}>← Back</a>
      </PrintBar>
      <header class="sheet-head">
        <h1>{c.name} — Word list</h1>
        <span>{ws.length} words · {new Date().toISOString().slice(0, 10)}</span>
      </header>
      <div class="columns">
        {ws.map((w, n) => (
          <Entry key={w.id} w={w} compact n={n + 1} />
        ))}
      </div>
    </div>
  );
}

/** Question sheet (with answer lines) and optional answer key, in the attempt's order. */
export function PrintTestPage({ id }: { id: string }) {
  const state = useAppState();
  const a = state.attempts.find((x) => x.id === id);
  const [withKey, setWithKey] = useState(true);
  const [questions, setQuestions] = useState(true);
  if (!a) return <Page title="Not found">Test not found.</Page>;
  const cycle = state.cycles.find((c) => c.id === a.cycleId);
  const testNo = cycle ? state.attempts.filter((x) => x.cycleId === cycle.id).findIndex((x) => x.id === a.id) + 1 : 0;
  const title = cycle ? `${cycle.name} — Test ${testNo}` : (a.label ?? "Vocabulary test");
  const ws = a.order.map((i) => wordById(i));
  return (
    <div class="printable">
      <PrintBar>
        <label><input type="checkbox" checked={questions} onChange={() => setQuestions(!questions)} /> questions</label>
        <label><input type="checkbox" checked={withKey} onChange={() => setWithKey(!withKey)} /> answer key</label>
        <a class="btn" href={`#/grade/${a.id}`}>Enter ○× results →</a>
        {cycle && <a class="btn" href={`#/cycle/${cycle.id}`}>← Back</a>}
      </PrintBar>
      {questions && (
        <section class="sheet">
          <header class="sheet-head">
            <h1>{title}</h1>
            <span>Date: ________ Score: ____ / {ws.length}</span>
          </header>
          <p class="small muted">Write the English word that matches each set of definitions and synonyms.</p>
          <div class="q-list">
            {ws.map((w, n) =>
              w ? (
                <div class="q-item" key={w.id}>
                  <Question w={w} settings={state.settings} n={n + 1} />
                  <div class="answer-line">Answer: ____________________</div>
                </div>
              ) : null,
            )}
          </div>
        </section>
      )}
      {withKey && (
        <section class="sheet key">
          <header class="sheet-head">
            <h1>{title} — Answer key</h1>
          </header>
          <ol class="key-list">
            {ws.map((w) =>
              w ? (
                <li key={w.id}>
                  <b>{w.w}</b> <Ipa w={w} /> <span class="q-pos">{w.pos.join(", ")}</span>
                  {w.ex[0] && (
                    <div class="small">
                      <Masked text={w.ex[0]} reveal />
                    </div>
                  )}
                </li>
              ) : null,
            )}
          </ol>
        </section>
      )}
    </div>
  );
}
