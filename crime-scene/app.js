// Casebook: a small detective-agency app used as the system under test.
//
// `?release=<name>` simulates deploying a different build. It is remembered for
// the browser session so it survives navigation:
//   stable        the correct app (default)
//   bug-accuse    naming the right culprit is reported as wrong
//   bug-evidence  the evidence counter stops updating
//   bug-close     closing a case leaves it on the open list
//   redesign      no bugs, but buttons, headings and test ids were renamed
//
// Network faults (latency, outages) are not simulated here: the test harness
// injects them at the network layer, like a chaos proxy would.

const RELEASES = ["stable", "bug-accuse", "bug-evidence", "bug-close", "redesign"];

const release = (() => {
  const fromUrl = new URLSearchParams(location.search).get("release");
  if (fromUrl && RELEASES.includes(fromUrl)) sessionStorage.setItem("release", fromUrl);
  return sessionStorage.getItem("release") || "stable";
})();

const TEXT =
  release === "redesign"
    ? {
        board: "Investigations",
        open: "Active investigations",
        closed: "Archive",
        openCase: "View file",
        accuse: "Name culprit",
        addEvidence: "Log evidence",
        close: "Archive case",
        evidenceId: "log-evidence-btn",
        closeId: "archive-btn",
      }
    : {
        board: "Case board",
        open: "Open cases",
        closed: "Closed cases",
        openCase: "Open case file",
        accuse: "Accuse",
        addEvidence: "Add evidence",
        close: "Close case",
        evidenceId: "add-evidence",
        closeId: "close-case",
      };

// ---- API -----------------------------------------------------------------
// Reads come from static JSON; writes are kept in sessionStorage and confirmed
// with a request to api/ack.json so they also cross the network.

async function request(path) {
  const res = await fetch(`api/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`The records office answered ${res.status}`);
  return res.json();
}

const overlay = {
  load() {
    return JSON.parse(sessionStorage.getItem("overlay") || '{"evidence":{},"status":{}}');
  },
  save(o) {
    sessionStorage.setItem("overlay", JSON.stringify(o));
  },
};

async function listCases() {
  const cases = await request("cases.json");
  const o = overlay.load();
  return cases.map((c) => ({
    ...c,
    status: o.status[c.id] ?? c.status,
    evidence: [...c.evidence, ...(o.evidence[c.id] ?? [])],
  }));
}

async function getCase(id) {
  const c = (await listCases()).find((x) => x.id === id);
  if (!c) throw new Error("No such case in the archive");
  return c;
}

async function addEvidence(id, text) {
  await request(`ack.json?op=evidence&case=${id}`);
  const o = overlay.load();
  (o.evidence[id] ??= []).push(text);
  overlay.save(o);
}

async function accuse(id, suspectId) {
  await request(`ack.json?op=accuse&case=${id}`);
  const c = await getCase(id);
  const right = suspectId === c.culprit;
  const reported = release === "bug-accuse" ? false : right;
  if (reported) {
    const o = overlay.load();
    o.status[id] = "solved";
    overlay.save(o);
  }
  return reported;
}

async function closeCase(id) {
  await request(`ack.json?op=close&case=${id}`);
  if (release === "bug-close") return;
  const o = overlay.load();
  o.status[id] = "closed";
  overlay.save(o);
}

// ---- Views ---------------------------------------------------------------

const root = document.getElementById("app");
const h = (html) => {
  root.innerHTML = html;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function showError(err) {
  h(`<section class="panel"><h1>Trail went cold</h1>
     <p role="alert" class="alert">${esc(err.message)}</p>
     <a href="#/board">Back to the ${esc(TEXT.board.toLowerCase())}</a></section>`);
}

function loginView() {
  h(`<section class="panel narrow">
      <h1>Detective sign-in</h1>
      <form id="login">
        <label>Badge number <input name="badge" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Sign in</button>
        <p id="login-error" role="alert" class="alert" hidden></p>
      </form>
    </section>`);
  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const error = document.getElementById("login-error");
    try {
      const detectives = await request("detectives.json");
      const d = detectives.find((x) => x.badge === form.get("badge") && x.password === form.get("password"));
      if (!d) {
        error.textContent = "Badge or password not recognized.";
        error.hidden = false;
        return;
      }
      sessionStorage.setItem("detective", d.name);
      location.hash = "#/board";
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

function card(c) {
  return `<li class="card" data-testid="case-card">
      <h3>${esc(c.title)}</h3>
      <p class="muted">${esc(c.district)} · <span class="chip ${c.status}">${c.status}</span>
        · <span data-testid="card-evidence-count">${c.evidence.length}</span> evidence</p>
      <a href="#/case/${c.id}" aria-label="${TEXT.openCase}: ${esc(c.title)}">${TEXT.openCase}</a>
    </li>`;
}

async function boardView() {
  h(`<p class="muted">Opening the files…</p>`);
  const cases = await listCases();
  const open = cases.filter((c) => c.status !== "closed");
  const closed = cases.filter((c) => c.status === "closed");
  h(`<section>
      <h1>${TEXT.board}</h1>
      <p class="muted">Welcome back, ${esc(sessionStorage.getItem("detective"))}.</p>
      <div class="columns">
        <section aria-labelledby="open-h"><h2 id="open-h">${TEXT.open} (${open.length})</h2>
          <ul class="cards" data-testid="open-cases">${open.map(card).join("")}</ul></section>
        <section aria-labelledby="closed-h"><h2 id="closed-h">${TEXT.closed} (${closed.length})</h2>
          <ul class="cards" data-testid="closed-cases">${closed.map(card).join("")}</ul></section>
      </div>
    </section>`);
}

async function caseView(id) {
  h(`<p class="muted">Pulling the case file…</p>`);
  const c = await getCase(id);
  // bug-evidence: the counter is computed from the seed data only.
  const shownCount = release === "bug-evidence" ? (await request("cases.json")).find((x) => x.id === id).evidence.length : c.evidence.length;
  h(`<article class="panel">
      <a href="#/board">← ${TEXT.board}</a>
      <h1>${esc(c.title)}</h1>
      <p class="muted">${esc(c.district)} · <span class="chip ${c.status}" data-testid="case-status">${c.status}</span></p>
      <p>${esc(c.summary)}</p>
      <p id="verdict" role="status" class="verdict" hidden></p>

      <h2>Suspects</h2>
      <ul class="suspects">
        ${c.suspects
          .map(
            (s) => `<li><div><strong>${esc(s.name)}</strong><p class="muted">${esc(s.note)}</p></div>
              <button data-suspect="${s.id}" ${c.status !== "open" ? "disabled" : ""}>${TEXT.accuse} ${esc(s.name)}</button></li>`,
          )
          .join("")}
      </ul>

      <h2>Evidence (<span data-testid="evidence-count">${shownCount}</span>)</h2>
      <ul class="evidence" data-testid="evidence-list">${c.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
      <form id="evidence-form">
        <label>New evidence <textarea name="text" rows="2" required></textarea></label>
        <button type="submit" data-testid="${TEXT.evidenceId}">${TEXT.addEvidence}</button>
      </form>

      <button class="primary" data-testid="${TEXT.closeId}" ${c.status === "solved" ? "" : "disabled"}>${TEXT.close}</button>
    </article>`);

  document.getElementById("evidence-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = new FormData(e.target).get("text").trim();
    if (!text) return;
    await guard(async () => {
      await addEvidence(id, text);
      await caseView(id);
    });
  });
  root.querySelectorAll("button[data-suspect]").forEach((b) =>
    b.addEventListener("click", () =>
      guard(async () => {
        const right = await accuse(id, b.dataset.suspect);
        if (right) await caseView(id);
        const v = document.getElementById("verdict");
        const name = c.suspects.find((s) => s.id === b.dataset.suspect).name;
        v.textContent = right ? `Case solved: ${name} did it.` : "Wrong suspect. Keep investigating.";
        v.className = `verdict ${right ? "good" : "bad"}`;
        v.hidden = false;
      }),
    ),
  );
  root.querySelector(`[data-testid="${TEXT.closeId}"]`).addEventListener("click", () =>
    guard(async () => {
      await closeCase(id);
      location.hash = "#/board";
    }),
  );
}

async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    showError(err);
  }
}

async function route() {
  const hash = location.hash || "#/";
  const signedIn = Boolean(sessionStorage.getItem("detective"));
  if (!signedIn && hash !== "#/") return loginView();
  if (hash === "#/") return signedIn ? boardView().catch(showError) : loginView();
  if (hash === "#/board") return boardView().catch(showError);
  const m = hash.match(/^#\/case\/(\w+)$/);
  if (m) return caseView(m[1]).catch(showError);
  showError(new Error("Unknown page"));
}

document.getElementById("release").textContent = release === "stable" ? "" : `release: ${release}`;
window.addEventListener("hashchange", route);
route();
