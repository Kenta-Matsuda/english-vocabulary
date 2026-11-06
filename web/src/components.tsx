import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { segments } from "./logic";
import { speak } from "./tts";
import type { Sense, Settings, Word, WordFilter } from "./types";
import { CEFR_LEVELS, LEVEL_SOURCES, SOURCE_LABEL } from "./types";

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
      <span class="tag" title={`CEFR level from ${SOURCE_LABEL[w.src]}`}>{w.cefr}</span>
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

/**
 * Letter boxes showing the answer length. When `typed` is given (online test), the boxes fill
 * with what has been typed so far, so you can see how many letters you have entered.
 */
export function HintBoxes({ w, settings, typed }: { w: Word; settings: Settings; typed?: string }) {
  if (!settings.showLengthHint && !settings.showFirstLetterHint) return null;
  if (!settings.showLengthHint) return <span class="hint">starts with “{w.w[0]}”</span>;
  const target = [...w.w];
  const t = typed != null ? [...typed.trim()] : null;
  const extra = t ? Math.max(0, t.length - target.length) : 0;
  return (
    <span class="letters-wrap">
      <span class="letters" aria-label={`${target.length} letters`}>
        {target.map((ch, i) => {
          const tc = t?.[i];
          const isSep = ch === " " || ch === "-";
          const content = tc ?? (i === 0 && settings.showFirstLetterHint ? ch : ch === "-" ? "-" : "");
          const cls = "lb" + (isSep && !tc ? " sep" : "") + (tc ? " filled" : t && i === t.length ? " cursor" : "") + (tc == null && i === 0 && settings.showFirstLetterHint ? " given" : "");
          return <span key={i} class={cls}>{content}</span>;
        })}
        {extra > 0 &&
          t!.slice(target.length).map((c, i) => (
            <span key={"x" + i} class="lb over">{c}</span>
          ))}
      </span>
      {t && (
        <span class={"lcount" + (extra ? " over" : t.length === target.length ? " full" : "")}>
          {t.length} / {target.length}
        </span>
      )}
    </span>
  );
}

export function Question({ w, settings, n, typed }: { w: Word; settings: Settings; n?: number; typed?: string }) {
  const senses = w.senses.slice(0, settings.sensesPerQuestion);
  return (
    <article class="qcard">
      <header class="qcard-head">
        {n != null && <span class="qno">{n}</span>}
        <HintBoxes w={w} settings={settings} typed={typed} />
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
  const sources = value.sources ?? [];
  const cefr = value.cefr ?? [];
  return (
    <div class="filter">
      <div class="frow">
        <span class="flabel">CEFR</span>
        {CEFR_LEVELS.map((c) => (
          <Chip key={c} on={cefr.includes(c)} onClick={() => onChange({ ...value, cefr: toggle(cefr, c) })}>{c}</Chip>
        ))}
      </div>
      <div class="frow">
        <span class="flabel" title="Which word list the CEFR level comes from">Source</span>
        {LEVEL_SOURCES.map((s) => (
          <Chip key={s} on={sources.includes(s)} onClick={() => onChange({ ...value, sources: toggle(sources, s) })}>{SOURCE_LABEL[s]}</Chip>
        ))}
        {!sources.length && <span class="small muted">(all lists)</span>}
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
