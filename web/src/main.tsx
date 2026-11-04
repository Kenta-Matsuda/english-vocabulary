import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { CyclePage, CyclesPage, NewCyclePage, QuickTestPage } from "./pages/cycles";
import { HistoryPage, HomePage, SettingsPage, WordPage, WordsPage } from "./pages/misc";
import { PrintListPage, PrintTestPage } from "./pages/print";
import { GradePage, TestPage } from "./pages/test";
import { useRoute } from "./router";
import { initStore, loadDataset } from "./store";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource/charis-sil/400-italic.css";
import "@fontsource/charis-sil/400.css";
import "./style.css";

function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([initStore(), loadDataset()])
      .then(() => setReady(true))
      .catch((e) => setError(String(e)));
  }, []);
  const { parts, query } = useRoute();
  if (error) return <p class="warn">{error}</p>;
  if (!ready) return <p class="loading">Loading word data…</p>;

  const [a, b, c] = parts;
  let page;
  if (!a) page = <HomePage />;
  else if (a === "cycles" && b === "new") page = <NewCyclePage key={query.get("prev") ?? ""} prevId={query.get("prev") ?? undefined} />;
  else if (a === "cycles") page = <CyclesPage />;
  else if (a === "cycle" && b) page = <CyclePage id={b} />;
  else if (a === "quick") page = <QuickTestPage />;
  else if (a === "test" && b) page = <TestPage key={b} id={b} />;
  else if (a === "grade" && b) page = <GradePage key={b} id={b} />;
  else if (a === "print" && b === "list" && c) page = <PrintListPage id={c} />;
  else if (a === "print" && b === "test" && c) page = <PrintTestPage id={c} />;
  else if (a === "words") page = <WordsPage />;
  else if (a === "word" && b) page = <WordPage id={b} />;
  else if (a === "history") page = <HistoryPage />;
  else if (a === "settings") page = <SettingsPage />;
  else page = <p>Page not found.</p>;

  const nav = [
    ["#/", "Home"],
    ["#/cycles", "Cycles"],
    ["#/quick", "Quick test"],
    ["#/words", "Words"],
    ["#/history", "History"],
    ["#/settings", "Settings"],
  ];
  const active = "#/" + (a ?? "");
  return (
    <>
      <header class="topbar no-print">
        <div class="topbar-in">
          <a class="brand" href="#/">
            <span class="brand-mark">Lexi<em>.</em></span>
            <span class="brand-sub">English in English</span>
          </a>
          <nav class="nav">
            {nav.map(([h, l]) => (
              <a key={h} href={h} class={active === h || (h === "#/cycles" && a === "cycle") || (h === "#/words" && a === "word") ? "on" : ""}>
                {l}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}

render(<App />, document.getElementById("app")!);
