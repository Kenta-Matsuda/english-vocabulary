import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Masked, posLabel } from "../components";
import { describeFilter } from "../logic";
import { useAppState, wordById } from "../store";
import type { Settings, Word } from "../types";
import { EIKEN_LABEL } from "../types";

const today = () => new Date().toISOString().slice(0, 10);

function PrintBar({ children, back }: { children?: ComponentChildren; back?: string }) {
  return (
    <div class="print-bar no-print">
      {back && <a class="btn ghost" href={back}>← Back</a>}
      <div class="print-bar-mid">{children}</div>
      <button class="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
    </div>
  );
}

function SheetHead({ kind, title, meta, right }: { kind: string; title: string; meta: string; right?: ComponentChildren }) {
  return (
    <header class="sh">
      <div class="sh-l">
        <div class="sh-kind">{kind}</div>
        <div class="sh-title">{title}</div>
        <div class="sh-meta">{meta}</div>
      </div>
      {right && <div class="sh-r">{right}</div>}
    </header>
  );
}

function LevelLine({ w }: { w: Word }) {
  const t = [w.cefr, w.eiken && EIKEN_LABEL[w.eiken], w.toeic && "TOEIC", w.toefl && "TOEFL"].filter(Boolean);
  return <div class="p-levels">{t.join(" · ")}</div>;
}

// ================================================================ study sheet

/** Memorisation sheet: headword + pronunciation + every definition, synonyms, phrases, examples. */
export function PrintListPage({ id }: { id: string }) {
  const state = useAppState();
  const [order, setOrder] = useState<"alpha" | "cycle">("alpha");
  const c = state.cycles.find((x) => x.id === id);
  if (!c) return <p>Cycle not found.</p>;
  let ws = c.wordIds.map((i) => wordById(i)).filter((w): w is Word => !!w);
  if (order === "alpha") ws = [...ws].sort((a, b) => a.w.localeCompare(b.w));
  return (
    <div class="print-view">
      <PrintBar back={`#/cycle/${c.id}`}>
        <div class="seg">
          <button class={order === "alpha" ? "on" : ""} onClick={() => setOrder("alpha")}>A–Z</button>
          <button class={order === "cycle" ? "on" : ""} onClick={() => setOrder("cycle")}>Carried-over first</button>
        </div>
      </PrintBar>
      <div class="paper">
        <SheetHead kind="Study Sheet" title={c.name} meta={`${ws.length} words · ${describeFilter(c.filter)} · ${today()}`} />
        <div class="study">
          {ws.map((w, n) => (
            <StudyItem key={w.id} w={w} n={n + 1} carried={c.carriedIds.includes(w.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StudyItem({ w, n, carried }: { w: Word; n: number; carried: boolean }) {
  return (
    <section class="st">
      <div class="st-no">{String(n).padStart(3, "0")}</div>
      <div class="st-head">
        <div class="st-word">
          {w.w}
          {carried && <span class="st-flag" title="carried over">★</span>}
        </div>
        {(w.ipa.us || w.ipa.uk) && <div class="st-ipa">{w.ipa.us ?? w.ipa.uk}</div>}
        <LevelLine w={w} />
        <div class="checks"><i /><i /><i /></div>
      </div>
      <div class="st-body">
        <ol class="p-defs">
          {w.senses.map((s, i) => (
            <li key={i}>
              <span class="p-n">{i + 1}</span>
              <span class="p-pos">{posLabel(s.p)}</span>
              <span class="p-def"><Masked text={s.d} reveal /></span>
              {s.s.length > 0 && <span class="p-syn"> ≈ {s.s.join(", ")}</span>}
            </li>
          ))}
        </ol>
        {w.col.length > 0 && (
          <div class="p-x">
            <span class="p-xl">Phrase</span>
            <span>{w.col.slice(0, 4).map((c, i) => <span key={i} class="p-phrase"><Masked text={c} reveal /></span>)}</span>
          </div>
        )}
        {w.ex.slice(0, 2).map((e, i) => (
          <div class="p-x" key={i}>
            <span class="p-xl">Ex.</span>
            <span class="p-ex"><Masked text={e} reveal /></span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ================================================================ test sheet + answer key

type Part = "test" | "key" | "both";

export function PrintTestPage({ id }: { id: string }) {
  const state = useAppState();
  const a = state.attempts.find((x) => x.id === id);
  const [part, setPart] = useState<Part>("test");
  if (!a) return <p>Test not found.</p>;
  const cycle = state.cycles.find((c) => c.id === a.cycleId);
  const testNo = cycle ? state.attempts.filter((x) => x.cycleId === cycle.id).findIndex((x) => x.id === a.id) + 1 : 0;
  const title = cycle ? `${cycle.name} — Test ${testNo}` : (a.label ?? "Vocabulary Test");
  const ws = a.order.map((i) => wordById(i)).filter((w): w is Word => !!w);
  return (
    <div class="print-view">
      <PrintBar back={cycle ? `#/cycle/${cycle.id}` : "#/history"}>
        <div class="seg">
          <button class={part === "test" ? "on" : ""} onClick={() => setPart("test")}>Test sheet</button>
          <button class={part === "key" ? "on" : ""} onClick={() => setPart("key")}>Answer key</button>
          <button class={part === "both" ? "on" : ""} onClick={() => setPart("both")}>Both</button>
        </div>
        <a class="btn ghost" href={`#/grade/${a.id}`}>Enter results →</a>
      </PrintBar>
      {part !== "key" && (
        <div class="paper">
          <SheetHead
            kind="Vocabulary Test"
            title={title}
            meta={`${ws.length} questions · Write the word that fits the definitions.`}
            right={
              <div class="score-box">
                <div><span>Date</span><i /></div>
                <div class="score"><span>Score</span><i /><b>/ {ws.length}</b></div>
              </div>
            }
          />
          <div class="tq-list">
            {ws.map((w, n) => <TestItem key={w.id} w={w} n={n + 1} settings={state.settings} />)}
          </div>
        </div>
      )}
      {part !== "test" && (
        <div class={"paper" + (part === "both" ? " break" : "")}>
          <SheetHead kind="Answer Key" title={title} meta={`${ws.length} answers`} />
          <ol class="key">
            {ws.map((w, n) => (
              <li key={w.id}>
                <span class="k-n">{n + 1}</span>
                <span class="k-w">{w.w}</span>
                <span class="k-ipa">{w.ipa.us ?? w.ipa.uk ?? ""}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function TestItem({ w, n, settings }: { w: Word; n: number; settings: Settings }) {
  const senses = w.senses.slice(0, settings.sensesPerQuestion);
  const cols = settings.showCollocations ? w.col.slice(0, 3) : [];
  const ex = settings.showExamples ? w.ex[0] : undefined;
  const boxes = settings.showLengthHint && w.w.length <= 16;
  return (
    <section class="tq">
      <div class="tq-no">{n}</div>
      <div class="tq-body">
        <ol class="p-defs">
          {senses.map((s, i) => (
            <li key={i}>
              <span class="p-n">{i + 1}</span>
              <span class="p-pos">{posLabel(s.p)}</span>
              <span class="p-def"><Masked text={s.d} /></span>
              {s.s.length > 0 && <span class="p-syn"> ≈ {s.s.join(", ")}</span>}
            </li>
          ))}
        </ol>
        {cols.length > 0 && (
          <div class="p-x">
            <span class="p-xl">Phrase</span>
            <span>{cols.map((c, i) => <span key={i} class="p-phrase"><Masked text={c} /></span>)}</span>
          </div>
        )}
        {ex && (
          <div class="p-x">
            <span class="p-xl">Ex.</span>
            <span class="p-ex"><Masked text={ex} /></span>
          </div>
        )}
      </div>
      <div class="tq-ans">
        {boxes ? (
          <div class="p-letters">
            {[...w.w].map((ch, i) => (
              <span key={i} class={ch === " " ? "sp" : ""}>{i === 0 && settings.showFirstLetterHint ? ch : ch === "-" ? "-" : ""}</span>
            ))}
          </div>
        ) : (
          <div class="p-line">
            {settings.showFirstLetterHint && <span class="p-first">{w.w[0]}</span>}
            {settings.showLengthHint && <span class="p-len">({w.w.length})</span>}
          </div>
        )}
      </div>
    </section>
  );
}
