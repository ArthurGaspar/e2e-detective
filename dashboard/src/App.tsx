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
          <span className="brand-mark" aria-hidden="true">CF<small>01</small></span>
          <span className="brand-name">
            <b>Case Files</b>
            <span>A test failure investigation lab</span>
          </span>
        </a>
        <nav className="tabs">
          <a href="#/" aria-current={page === "board" || page === "case" ? "page" : undefined}>Cases</a>
          <a href="#/model" aria-current={page === "model" ? "page" : undefined}>Method & results</a>
          <a href="#/patrols" aria-current={page === "patrols" ? "page" : undefined}>Run log</a>
        </nav>
        <button className="icon-btn" onClick={cycleTheme} aria-label={`Theme: ${theme}`} title="Theme: system, light, dark">
          {theme === "system" ? "Auto" : theme === "light" ? "Light" : "Dark"}
        </button>
      </header>
      <main id="content" tabIndex={-1}>
        {page === "case" && <CaseFile id={caseId!} />}
        {page === "board" && <Board />}
        {page === "model" && <ModelPage />}
        {page === "patrols" && <Patrols />}
      </main>
      <footer className="site-footer">
        <span>Built by <a href="https://github.com/ArthurGaspar">Arthur Gaspar</a> · São Paulo, Brazil</span>
        <span>TypeScript / Playwright / local inference</span>
        <a href="https://github.com/ArthurGaspar/e2e-detective">Read the source ↗</a>
      </footer>
    </>
  );
}
