import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { hintFor, segments } from "./logic";
import { speak } from "./tts";
import type { Settings, Word, WordFilter } from "./types";
import { CEFR_LEVELS, EIKEN_GRADES, EIKEN_LABEL } from "./types";

export function Masked({ text, reveal }: { text: string; reveal?: boolean }) {
  return (
    <>
      {segments(text).map((s, i) =>
        s.hit ? (
          reveal ? (
            <mark key={i}>{s.text}</mark>
          ) : (
            <span key={i} class="blank">
              ______
            </span>
          )
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function SpeakButton({ text, label = "▶" }: { text: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <button
      class="speak no-print"
      title={err || "Play pronunciation"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setErr("");
        try {
          await speak(text);
        } catch (e) {
          setErr(String((e as Error).message ?? e));
          alertless(String((e as Error).message ?? e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : label}
    </button>
  );
}

/** Show an error without blocking dialogs. */
export function alertless(msg: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

export function Tags({ w }: { w: Word }) {
  return (
    <span class="tags">
      {w.cefr && <span class="tag cefr">{w.cefr}</span>}
      {w.eiken && <span class="tag eiken">{EIKEN_LABEL[w.eiken]}</span>}
      {w.toeic && <span class="tag toeic">TOEIC</span>}
      {w.toefl && <span class="tag toefl">TOEFL</span>}
    </span>
  );
}

export function Ipa({ w }: { w: Word }) {
  return (
    <span class="ipa">
      {w.ipa.us && <span>US {w.ipa.us}</span>}
      {w.ipa.uk && <span> UK {w.ipa.uk}</span>}
    </span>
  );
}

/** The question side: definitions + synonyms + collocations + example, headword hidden. */
export function Question({ w, settings, n }: { w: Word; settings: Settings; n?: number }) {
  const senses = w.senses.slice(0, settings.sensesPerQuestion);
  const hint = hintFor(w, settings);
  return (
    <div class="question">
      <div class="q-head">
        {n != null && <span class="q-num">{n}.</span>}
        <span class="q-pos">({[...new Set(senses.map((s) => s.p))].join(", ")})</span>
        {hint && <span class="q-hint">{hint}</span>}
      </div>
      <ol class="senses">
        {senses.map((s, i) => (
          <li key={i}>
            <Masked text={s.d} />
            {s.s.length > 0 && <span class="syn"> — syn: {s.s.join(", ")}</span>}
          </li>
        ))}
      </ol>
      {settings.showCollocations && w.col.length > 0 && (
        <div class="col">
          <b>Phrases:</b>{" "}
          {w.col.slice(0, 3).map((c, i) => (
            <span key={i}>
              {i > 0 && " / "}
              <Masked text={c} />
            </span>
          ))}
        </div>
      )}
      {settings.showExamples && w.ex.length > 0 && (
        <div class="ex">
          <b>e.g.</b> <Masked text={w.ex[0]} />
        </div>
      )}
    </div>
  );
}

/** Full entry (word list / answer key / word page). */
export function Entry({ w, compact, n }: { w: Word; compact?: boolean; n?: number }) {
  return (
    <div class={"entry" + (compact ? " compact" : "")}>
      <div class="e-head">
        {n != null && <span class="q-num">{n}.</span>}
        <a class="e-word" href={`#/word/${encodeURIComponent(w.id)}`}>
          {w.w}
        </a>
        <SpeakButton text={w.w} />
        <Ipa w={w} />
        <span class="q-pos">{w.pos.join(", ")}</span>
        <Tags w={w} />
      </div>
      <ol class="senses">
        {w.senses.map((s, i) => (
          <li key={i}>
            <span class="q-pos">{s.p}</span> <Masked text={s.d} reveal />
            {s.s.length > 0 && <span class="syn"> — syn: {s.s.join(", ")}</span>}
          </li>
        ))}
      </ol>
      {w.col.length > 0 && (
        <div class="col">
          <b>Phrases:</b>{" "}
          {w.col.map((c, i) => (
            <span key={i}>
              {i > 0 && " / "}
              <Masked text={c} reveal />
            </span>
          ))}
        </div>
      )}
      {w.ex.length > 0 && (
        <ul class="ex">
          {(compact ? w.ex.slice(0, 2) : w.ex).map((e, i) => (
            <li key={i}>
              <Masked text={e} reveal /> <SpeakButton text={e.replace(/\[\[|\]\]/g, "")} label="🔊" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FilterEditor({ value, onChange }: { value: WordFilter; onChange: (f: WordFilter) => void }) {
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div class="filter">
      <div>
        <b>CEFR</b>{" "}
        {CEFR_LEVELS.map((c) => (
          <label key={c}>
            <input type="checkbox" checked={value.cefr.includes(c)} onChange={() => onChange({ ...value, cefr: toggle(value.cefr, c) })} />
            {c}
          </label>
        ))}
      </div>
      <div>
        <b>Eiken</b>{" "}
        {EIKEN_GRADES.map((g) => (
          <label key={g}>
            <input type="checkbox" checked={value.eiken.includes(g)} onChange={() => onChange({ ...value, eiken: toggle(value.eiken, g) })} />
            {EIKEN_LABEL[g]}
          </label>
        ))}
      </div>
      <div>
        <b>Exams</b>{" "}
        <label>
          <input type="checkbox" checked={value.toeic} onChange={() => onChange({ ...value, toeic: !value.toeic })} />
          TOEIC
        </label>
        <label>
          <input type="checkbox" checked={value.toefl} onChange={() => onChange({ ...value, toefl: !value.toefl })} />
          TOEFL
        </label>
      </div>
      <div>
        <b>Combine</b>{" "}
        <label>
          <input type="radio" checked={value.mode === "any"} onChange={() => onChange({ ...value, mode: "any" })} />
          any (OR)
        </label>
        <label>
          <input type="radio" checked={value.mode === "all"} onChange={() => onChange({ ...value, mode: "all" })} />
          all (AND)
        </label>
      </div>
    </div>
  );
}

export function CountPicker({ value, onChange, max }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <span class="count-picker">
      {[10, 20, 50, 100].map((n) => (
        <button key={n} class={value === n ? "on" : ""} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onInput={(e) => onChange(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))}
      />
    </span>
  );
}

export function Page({ title, children, actions }: { title: string; children: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <section class="page">
      <div class="page-head">
        <h1>{title}</h1>
        {actions && <div class="actions no-print">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
