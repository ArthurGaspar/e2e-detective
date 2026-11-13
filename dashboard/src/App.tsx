import { useEffect, useState } from "react";
import { Board } from "./Board";
import { CaseFile } from "./CaseFile";
import { ModelPage } from "./ModelPage";
import { Patrols } from "./Patrols";

type Theme = "system" | "light" | "dark";

function useHash(): string {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => {
      if (location.hash && !location.hash.startsWith("#/")) return;
      setHash(location.hash || "#/");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem("case-files-theme");
      return stored === "light" || stored === "dark" ? stored : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("case-files-theme", theme);
    } catch {
      // storage can be unavailable; the theme still applies for this visit
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"))];
}

export function App() {
  const hash = useHash();
  const [theme, cycleTheme] = useTheme();
  const caseId = hash.match(/^#\/case\/(.+)$/)?.[1];
  const page = caseId ? "case" : hash === "#/model" ? "model" : hash === "#/patrols" ? "patrols" : "board";

  return (
    <>
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="top">
        <a className="brand" href="#/">
          <svg className="brand-mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="20" cy="20" r="14" strokeWidth="1.5" />
            <path d="m30 30 12 12m-10-15 12 12M12 23c-4-12 12-18 17-7M15 25c-6-12 12-17 12-5M18 27c-6-9 6-16 7-7M20 22c-2-5 3-7 3-2" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="brand-name">
            <b>Case Files</b>
            <span>Test failure investigations</span>
          </span>
        </a>
        <nav className="tabs">
          <a href="#/" aria-current={page === "board" || page === "case" ? "page" : undefined}>Case desk</a>
          <a href="#/model" aria-current={page === "model" ? "page" : undefined}>Lab notes</a>
          <a href="#/patrols" aria-current={page === "patrols" ? "page" : undefined}>Run log</a>
        </nav>
        <button className="icon-btn" onClick={cycleTheme} aria-label={`Theme: ${theme}`} title="Theme: system, light, dark">
          {theme === "system" ? "Auto" : theme === "light" ? "Light" : "Dark"}
        </button>
      </header>
      <main id="content" tabIndex={-1}>
        <aside className="privacy-notice" aria-labelledby="privacy-label">
          <strong id="privacy-label">LGPD safeguards</strong>
          <span>New patrol evidence uses screenshot masking and data redaction. CI checks artifacts before publication.</span>
          <a href="https://github.com/ArthurGaspar/e2e-detective#data-collection-retention-and-lgpd">Data collection and retention</a>
        </aside>
        {page === "case" && <CaseFile id={caseId!} />}
        {page === "board" && <Board />}
        {page === "model" && <ModelPage />}
        {page === "patrols" && <Patrols />}
      </main>
      <footer className="site-footer">
        <span><a href="https://github.com/ArthurGaspar">Arthur Gaspar</a> / São Paulo</span>
        <span>Synthetic faults. Recorded evidence. Local inference.</span>
        <a href="https://github.com/ArthurGaspar/e2e-detective">Source & field notes ↗</a>
      </footer>
    </>
  );
}
