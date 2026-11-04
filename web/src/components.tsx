import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { segments } from "./logic";
import { speak } from "./tts";
import type { Sense, Settings, Word, WordFilter } from "./types";
import { CEFR_LEVELS, EIKEN_GRADES, EIKEN_LABEL } from "./types";

// ---------------------------------------------------------------- text helpers

export function Masked({ text, reveal }: { text: string; reveal?: boolean }) {
  return (
    <>
      {segments(text).map((s, i) =>
        s.hit ? (
          reveal ? (
            <strong key={i} class="hw">{s.text}</strong>
          ) : (
            <span key={i} class="gap" aria-label="blank" />
          )
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

const POS_SHORT: Record<string, string> = { n: "n.", v: "v.", adj: "adj.", adv: "adv.", prep: "prep.", conj: "conj.", pron: "pron.", det: "det.", intj: "interj.", num: "num.", part: "part." };
export const posLabel = (p: string) => POS_SHORT[p] ?? p;

export function Pos({ p }: { p: string }) {
  return <span class="pos">{posLabel(p)}</span>;
}

export function SpeakButton({ text, small }: { text: string; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      class={"speak no-print" + (small ? " sm" : "")}
      title="Play pronunciation"
      aria-label="Play pronunciation"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await speak(text);
        } catch (e) {
          toast(String((e as Error).message ?? e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <svg viewBox="0 0 24 24" width={small ? 12 : 14} height={small ? 12 : 14} aria-hidden="true">
        {busy ? <circle cx="12" cy="12" r="4" fill="currentColor" /> : <path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" fill="currentColor" />}
      </svg>
    </button>
  );
}

/** Non-blocking notification (no browser dialogs). */
export function toast(msg: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
export const alertless = toast;

export function Tags({ w }: { w: Word }) {
  return (
    <span class="tags">
      {w.cefr && <span class="tag">{w.cefr}</span>}
      {w.eiken && <span class="tag">{EIKEN_LABEL[w.eiken]}</span>}
      {w.toeic && <span class="tag">TOEIC</span>}
      {w.toefl && <span class="tag">TOEFL</span>}
    </span>
  );
}

export function Ipa({ w, one }: { w: Word; one?: boolean }) {
  const us = w.ipa.us;
  const uk = w.ipa.uk;
  if (!us && !uk) return null;
  if (one || !uk || uk === us) return <span class="ipa">{us ?? uk}</span>;
  return (
    <span class="ipa">
      {us && <><span class="ipa-l">US</span>{us}</>}
      {uk && <><span class="ipa-l">UK</span>{uk}</>}
    </span>
  );
}

function SenseList({ senses, reveal }: { senses: Sense[]; reveal?: boolean }) {
  return (
    <ol class="defs">
      {senses.map((s, i) => (
        <li key={i}>
          <span class="def-n">{i + 1}</span>
          <div>
            <Pos p={s.p} /> <span class="def"><Masked text={s.d} reveal={reveal} /></span>
            {s.s.length > 0 && (
              <div class="syn">
                <span class="mk">≈</span>
                {s.s.join(", ")}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Extras({ w, reveal, phrases = 3, examples = 1 }: { w: Word; reveal?: boolean; phrases?: number; examples?: number }) {
  const cols = w.col.slice(0, phrases);
  const exs = w.ex.slice(0, examples);
  if (!cols.length && !exs.length) return null;
  return (
    <div class="extras">
      {cols.length > 0 && (
        <div class="xrow">
          <span class="xlabel">Phrase</span>
          <span>
            {cols.map((c, i) => (
              <span key={i} class="phrase">
                <Masked text={c} reveal={reveal} />
              </span>
            ))}
          </span>
        </div>
      )}
      {exs.map((e, i) => (
        <div class="xrow" key={i}>
          <span class="xlabel">Ex.</span>
          <span class="example">
            <Masked text={e} reveal={reveal} />
            {reveal && <SpeakButton text={e.replace(/\[\[|\]\]/g, "")} small />}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- question / entry (screen)

export function HintBoxes({ w, settings }: { w: Word; settings: Settings }) {
  if (!settings.showLengthHint && !settings.showFirstLetterHint) return null;
  if (!settings.showLengthHint) return <span class="hint">starts with “{w.w[0]}”</span>;
  return (
    <span class="letters" aria-label={`${w.w.length} letters`}>
      {[...w.w].map((ch, i) => (
        <span key={i} class={"lb" + (ch === " " || ch === "-" ? " sep" : "")}>
          {i === 0 && settings.showFirstLetterHint ? ch : ch === "-" ? "-" : ""}
        </span>
      ))}
    </span>
  );
}

export function Question({ w, settings, n }: { w: Word; settings: Settings; n?: number }) {
  const senses = w.senses.slice(0, settings.sensesPerQuestion);
  return (
    <article class="qcard">
      <header class="qcard-head">
        {n != null && <span class="qno">{n}</span>}
        <HintBoxes w={w} settings={settings} />
      </header>
      <SenseList senses={senses} />
      <Extras w={w} phrases={settings.showCollocations ? 3 : 0} examples={settings.showExamples ? 1 : 0} />
    </article>
  );
}

export function Entry({ w, compact, n }: { w: Word; compact?: boolean; n?: number }) {
  return (
    <article class={"entry" + (compact ? " compact" : "")}>
      <header class="entry-head">
        {n != null && <span class="qno sm">{n}</span>}
        <a class="headword" href={`#/word/${encodeURIComponent(w.id)}`}>{w.w}</a>
        <SpeakButton text={w.w} />
        <Ipa w={w} />
        <Tags w={w} />
      </header>
      <SenseList senses={w.senses} reveal />
      <Extras w={w} reveal phrases={compact ? 3 : 6} examples={compact ? 1 : 4} />
    </article>
  );
}

// ---------------------------------------------------------------- forms

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class={"chip" + (on ? " on" : "")} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function FilterEditor({ value, onChange }: { value: WordFilter; onChange: (f: WordFilter) => void }) {
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div class="filter">
      <div class="frow">
        <span class="flabel">CEFR</span>
        {CEFR_LEVELS.map((c) => (
          <Chip key={c} on={value.cefr.includes(c)} onClick={() => onChange({ ...value, cefr: toggle(value.cefr, c) })}>{c}</Chip>
        ))}
      </div>
      <div class="frow">
        <span class="flabel">Eiken</span>
        {EIKEN_GRADES.map((g) => (
          <Chip key={g} on={value.eiken.includes(g)} onClick={() => onChange({ ...value, eiken: toggle(value.eiken, g) })}>{EIKEN_LABEL[g].replace("Eiken ", "Grade ")}</Chip>
        ))}
      </div>
      <div class="frow">
        <span class="flabel">Exam</span>
        <Chip on={value.toeic} onClick={() => onChange({ ...value, toeic: !value.toeic })}>TOEIC</Chip>
        <Chip on={value.toefl} onClick={() => onChange({ ...value, toefl: !value.toefl })}>TOEFL</Chip>
      </div>
      <div class="frow">
        <span class="flabel">Match</span>
        <div class="seg">
          <button type="button" class={value.mode === "any" ? "on" : ""} onClick={() => onChange({ ...value, mode: "any" })}>Any</button>
          <button type="button" class={value.mode === "all" ? "on" : ""} onClick={() => onChange({ ...value, mode: "all" })}>All</button>
        </div>
      </div>
    </div>
  );
}

export function CountPicker({ value, onChange, max }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div class="count-picker">
      <div class="seg">
        {[10, 20, 50, 100].map((n) => (
          <button type="button" key={n} class={value === n ? "on" : ""} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        aria-label="Custom count"
        onInput={(e) => onChange(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))}
      />
    </div>
  );
}

export function Page({ title, eyebrow, children, actions, narrow }: { title: string; eyebrow?: string; children: ComponentChildren; actions?: ComponentChildren; narrow?: boolean }) {
  return (
    <section class={"page" + (narrow ? " narrow" : "")}>
      <header class="page-head">
        <div>
          {eyebrow && <div class="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
        </div>
        {actions && <div class="actions no-print">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ComponentChildren; sub?: ComponentChildren }) {
  return (
    <div class="stat">
      <div class="stat-l">{label}</div>
      <div class="stat-v">{value}</div>
      {sub && <div class="stat-s">{sub}</div>}
    </div>
  );
}
