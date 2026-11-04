import { Fragment } from "preact";
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
  const cycle = state.cycles.find((c) => c.id === a.cycleId);

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
    <Page eyebrow={cycle ? cycle.name : "Quick test"} title="Online test" narrow>
      <div class="test-top">
        <div class="meter"><i style={{ width: `${(100 * (i + 1)) / total}%` }} /></div>
        <span class="counter">{i + 1} / {total} · answered {answered}</span>
      </div>
      {w ? <Question w={w} settings={state.settings} n={i + 1} /> : <p>Missing word {a.order[i]}</p>}
      <form
        class="answer"
        onSubmit={(e) => {
          e.preventDefault();
          i < total - 1 ? next() : finish();
        }}
      >
        <button type="button" class="ghost" disabled={i === 0} onClick={() => (save(val), setI(i - 1))} aria-label="Previous question">←</button>
        <input
          ref={input}
          value={val}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          placeholder="Your answer"
          aria-label="Your answer"
          onInput={(e) => setVal((e.target as HTMLInputElement).value)}
        />
        {i < total - 1 ? (
          <button class="primary lg" type="submit">Next</button>
        ) : (
          <button class="primary lg" type="submit">Finish</button>
        )}
      </form>
      <div class="kbd-note">
        Press Enter for the next question. Blank answers count as wrong. Progress is saved automatically —{" "}
        <a href="javascript:void 0" onClick={finish}>finish and grade now</a>
      </div>
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
  const total = a.order.length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(a.results ?? null);
  const cycle = state.cycles.find((c) => c.id === a.cycleId);

  const save = () => {
    update((s) => {
      const t = s.attempts.find((x) => x.id === id)!;
      t.results = { ...draft };
      t.completedAt ??= new Date().toISOString();
    });
  };

  return (
    <Page
      eyebrow={cycle ? cycle.name : (a.label ?? "Quick test")}
      title={a.mode === "paper" ? "Paper test — results" : "Results"}
      actions={
        <>
          {a.cycleId && <a class="btn ghost" href={`#/cycle/${a.cycleId}`}>← Back to cycle</a>}
          <button class="primary" disabled={!dirty && !!a.results} onClick={save}>
            {a.results ? (dirty ? "Save changes" : "Saved") : "Save results"}
          </button>
        </>
      }
    >
      <div class="panel result-head">
        <div class="big-score">
          {correct}<small> / {total}</small>
        </div>
        <div>
          <div><b>{Math.round((100 * correct) / total)}%</b> correct · {total - correct} to review</div>
          <div class="small muted">
            {a.mode === "paper" && !a.results
              ? "Every question starts as ○. Tap the ones you missed to mark them ×, then save."
              : "Tap a mark to correct the grading (e.g. an acceptable alternative answer)."}
            {!a.results && <span class="warn"> Not saved yet.</span>}
          </div>
        </div>
        <label class="small" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} />
          Show entries for correct answers
        </label>
      </div>
      <table class="list grade">
        <thead>
          <tr><th>No.</th><th>Mark</th><th>Word</th>{a.mode === "online" && <th>Your answer</th>}</tr>
        </thead>
        <tbody>
          {a.order.map((wid, n) => {
            const w = wordById(wid);
            const ok = draft[wid];
            return (
              <Fragment key={wid}>
                <tr class={ok ? "ok" : "ng"}>
                  <td class="num">{n + 1}</td>
                  <td style={{ width: "64px" }}>
                    <button class={"mark " + (ok ? "ok" : "ng")} aria-label={ok ? "correct" : "wrong"} onClick={() => setDraft((d) => ({ ...d, [wid]: !d[wid] }))}>
                      {ok ? "○" : "×"}
                    </button>
                  </td>
                  <td class="word-cell">
                    <a href={`#/word/${encodeURIComponent(wid)}`}>{w?.w ?? wid}</a>
                  </td>
                  {a.mode === "online" && <td class="typed">{a.answers?.[wid] || <span class="muted">—</span>}</td>}
                </tr>
                {w && (!ok || showAll) && (a.results || a.mode === "online") && (
                  <tr class="detail">
                    <td></td>
                    <td colSpan={3}>
                      <Entry w={w} compact />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Page>
  );
}
