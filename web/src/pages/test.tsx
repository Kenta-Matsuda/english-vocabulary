import { useEffect, useRef, useState } from "preact/hooks";
import { Entry, Page, Question } from "../components";
import { isCorrect } from "../logic";
import { update, useAppState, wordById } from "../store";
import { go } from "../router";

/** Online test: one question at a time, typed answers, graded automatically at the end. */
export function TestPage({ id }: { id: string }) {
  const state = useAppState();
  const a = state.attempts.find((x) => x.id === id);
  const answers = a?.answers ?? {};
  const firstOpen = a ? Math.max(0, a.order.findIndex((w) => !(w in answers))) : 0;
  const [i, setI] = useState(firstOpen);
  const [val, setVal] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (a) setVal(answers[a.order[i]] ?? "");
    input.current?.focus();
  }, [i, a?.id]);

  if (!a) return <Page title="Not found">Test not found.</Page>;
  if (a.results) return <GradePage id={id} />;
  const w = wordById(a.order[i]);
  const total = a.order.length;
  const answered = Object.values(answers).filter((v) => v.trim()).length;

  const save = (v: string) =>
    update((s) => {
      const t = s.attempts.find((x) => x.id === id)!;
      t.answers = { ...(t.answers ?? {}), [t.order[i]]: v };
    });
  const next = () => {
    save(val);
    if (i < total - 1) setI(i + 1);
  };
  const finish = () => {
    save(val);
    update((s) => {
      const t = s.attempts.find((x) => x.id === id)!;
      const results: Record<string, boolean> = {};
      for (const wid of t.order) {
        const word = wordById(wid);
        results[wid] = !!word && isCorrect(word, t.answers?.[wid] ?? "");
      }
      t.results = results;
      t.completedAt = new Date().toISOString();
    });
    go(`#/grade/${id}`);
  };

  return (
    <Page title={a.label ?? "Online test"}>
      <div class="progress">
        <div class="bar" style={{ width: `${(100 * answered) / total}%` }} />
        <span>
          Question {i + 1} / {total} · answered {answered}
        </span>
      </div>
      {w ? <Question w={w} settings={state.settings} n={i + 1} /> : <p>Missing word {a.order[i]}</p>}
      <form
        class="answer"
        onSubmit={(e) => {
          e.preventDefault();
          i < total - 1 ? next() : finish();
        }}
      >
        <input
          ref={input}
          value={val}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder="Type the word and press Enter"
          onInput={(e) => setVal((e.target as HTMLInputElement).value)}
        />
        <button type="button" disabled={i === 0} onClick={() => (save(val), setI(i - 1))}>
          ← Prev
        </button>
        {i < total - 1 ? <button class="primary" type="submit">Next →</button> : null}
        <button type="button" class={i === total - 1 ? "primary" : ""} onClick={finish}>
          Finish &amp; grade
        </button>
      </form>
      <p class="muted small">Unanswered questions are graded as wrong. Progress is saved; you can leave and continue later.</p>
    </Page>
  );
}

/**
 * Grading view. For online tests it shows typed answers (auto-graded, editable);
 * for paper tests it is the ○/× entry sheet in the printed order.
 */
export function GradePage({ id }: { id: string }) {
  const state = useAppState();
  const a = state.attempts.find((x) => x.id === id);
  const [draft, setDraft] = useState<Record<string, boolean>>(() =>
    a?.results ? { ...a.results } : Object.fromEntries((a?.order ?? []).map((w) => [w, true])),
  );
  const [showAll, setShowAll] = useState(false);
  if (!a) return <Page title="Not found">Test not found.</Page>;
  const correct = Object.values(draft).filter(Boolean).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(a.results ?? null);

  const save = () => {
    update((s) => {
      const t = s.attempts.find((x) => x.id === id)!;
      t.results = { ...draft };
      t.completedAt ??= new Date().toISOString();
    });
  };

  return (
    <Page
      title={(a.mode === "paper" ? "Paper test results" : "Test results") + (a.label ? ` — ${a.label}` : "")}
      actions={
        <>
          {a.cycleId && <a class="btn" href={`#/cycle/${a.cycleId}`}>← Cycle</a>}
          <button class="primary" disabled={!dirty && !!a.results} onClick={save}>
            {a.results ? "Save changes" : "Save results"}
          </button>
        </>
      }
    >
      <p class="score">
        {correct} / {a.order.length} correct ({Math.round((100 * correct) / a.order.length)}%)
        {!a.results && <span class="warn"> — not saved yet</span>}
      </p>
      {a.mode === "paper" && !a.results && (
        <p class="muted">All questions start as ○. Click the questions you got wrong to mark them ×, then save.</p>
      )}
      <label class="no-print">
        <input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} /> show details for correct answers too
      </label>
      <table class="list grade">
        <thead>
          <tr><th>#</th><th>○/×</th><th>Word</th>{a.mode === "online" && <th>Your answer</th>}</tr>
        </thead>
        <tbody>
          {a.order.map((wid, n) => {
            const w = wordById(wid);
            const ok = draft[wid];
            return (
              <>
                <tr key={wid} class={ok ? "ok" : "ng"}>
                  <td>{n + 1}</td>
                  <td>
                    <button class={"mark " + (ok ? "ok" : "ng")} onClick={() => setDraft((d) => ({ ...d, [wid]: !d[wid] }))}>
                      {ok ? "○" : "×"}
                    </button>
                  </td>
                  <td>
                    <a href={`#/word/${encodeURIComponent(wid)}`}>{w?.w ?? wid}</a>
                  </td>
                  {a.mode === "online" && <td class="typed">{a.answers?.[wid] || <span class="muted">(blank)</span>}</td>}
                </tr>
                {w && (!ok || showAll) && (a.results || a.mode === "online") && (
                  <tr class="detail">
                    <td></td>
                    <td colSpan={3}>
                      <Entry w={w} compact />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </Page>
  );
}
