"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const INK = "#101822";
const INK_2 = "#18222F";
const INK_3 = "#22303F";
const PAPER = "#EDE8DF";
const MUTE = "#8798A8";
const SIGNAL = "#F2A03D";
const LIVE = "#5FC9A3";
const ALERT = "#E3644F";
const COOL = "#7BA7D4";

const FACTORS = [
  { key: "delay", label: "DELAY", weight: 30, color: "#E3644F" },
  { key: "waiting", label: "WAITING", weight: 25, color: "#F2A03D" },
  { key: "blocking", label: "BLOCKING", weight: 20, color: "#C9A0DC" },
  { key: "committed", label: "COMMITTED", weight: 15, color: "#7BA7D4" },
  { key: "effort", label: "QUICK", weight: 10, color: "#5FC9A3" },
];

const TABS = [
  { id: "queue", label: "Queue", hint: "Needs a decision from you" },
  { id: "proposals", label: "Proposals", hint: "Decisions about the system, not your work" },
  { id: "unsure", label: "Unsure", hint: "It could not classify these" },
  { id: "drops", label: "Drops", hint: "It wants to ignore these" },
  { id: "parked", label: "Parked", hint: "Not now, not never" },
  { id: "done", label: "Done", hint: "Already carried out" },
];

const BUCKETS = [
  { id: "for-me", label: "Mine", color: LIVE },
  { id: "delegate", label: "Delegate", color: "#C9A0DC" },
  { id: "park", label: "Park", color: MUTE },
  { id: "keep-dropped", label: "Keep dropped", color: INK_3 },
];

function tabOf(labels = []) {
  const has = (l) => labels.includes(l);
  // buddy-done is terminal and checked first, deliberately. A resolved
  // proposal (buddy-proposal + buddy-done) or a closed drop must not keep
  // showing in its original tab forever just because that label was never
  // stripped. Whatever else a ticket carries, "done" wins.
  if (has("buddy-done")) return "done";
  if (has("buddy-proposal")) return "proposals";
  if (has("buddy-unsure")) return "unsure";
  if (has("buddy-proposed-drop")) return "drops";
  if (has("buddy-parked")) return "parked";
  if (has("for-me") || has("delegate") || has("autonomous")) return "queue";
  return null;
}

/* Discovers which scoring/ranking systems actually appear in the loaded
   tickets, rather than assuming a fixed set. A future second scorer or
   ranker starts showing up here automatically the moment it writes its
   first tagged comment — no UI change needed. "Newest first" always exists,
   even before any system has ever scored anything. */
function discoverLenses(issues) {
  const rankSystems = new Set();
  const scoreSystems = new Set();
  for (const i of issues) {
    if (i.ranks) Object.keys(i.ranks).forEach((s) => rankSystems.add(s));
    if (i.scores) Object.keys(i.scores).forEach((s) => scoreSystems.add(s));
  }
  const lenses = [];
  for (const s of rankSystems) lenses.push({ id: `rank:${s}`, label: `Ranking (${s})`, type: "rank", system: s });
  for (const s of scoreSystems) lenses.push({ id: `score:${s}`, label: `Score (${s})`, type: "score", system: s });
  lenses.push({ id: "recency", label: "Newest first", type: "recency" });
  return lenses;
}

/* Within-band tiebreak only — band itself is always the outer sort and this
   function never touches it. A ticket the chosen lens has no data for falls
   after ones it does have data for; an explicit judgment beats a guess. */
function compareByLens(a, b, lens) {
  if (!lens || lens.type === "recency") {
    return new Date(b.createdAt) - new Date(a.createdAt);
  }
  if (lens.type === "rank") {
    const ar = a.ranks?.[lens.system];
    const br = b.ranks?.[lens.system];
    if (ar && br) return ar.position - br.position;
    if (ar && !br) return -1;
    if (!ar && br) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  }
  if (lens.type === "score") {
    const as = a.scores?.[lens.system]?.total;
    const bs = b.scores?.[lens.system]?.total;
    if (as != null && bs != null) return bs - as;
    if (as != null && bs == null) return -1;
    if (as == null && bs != null) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  }
  return 0;
}

const btn = (bg, fg, border) => ({
  background: bg,
  border: border || "none",
  borderRadius: 3,
  color: fg,
  padding: "8px 15px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
});

const box = {
  width: "100%",
  background: INK,
  border: `1px solid ${INK_3}`,
  borderRadius: 3,
  color: PAPER,
  padding: 10,
  fontSize: 13,
  lineHeight: 1.5,
  fontFamily: "inherit",
  resize: "vertical",
  boxSizing: "border-box",
};

/* One row of the thread. Sources (from a Routine 5 answer) fold under a
   plain disclosure, same as before — just no longer a separate block. */
function Msg({ r }) {
  return (
    <div className={`td-msg ${r.you ? "td-you" : ""}`}>
      <div className="td-msg-who">{r.who}</div>
      <div className="td-msg-body">{r.body}</div>
      {r.sources?.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", color: "var(--text-3)", fontSize: 12 }}>
            Where this came from ({r.sources.length})
          </summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--text-3)", fontSize: 12.5, lineHeight: 1.6 }}>
            {r.sources.map((s, j) => (
              <li key={j}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Spine({ breakdown, total }) {
  if (!breakdown || !total) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", background: INK_3 }}>
        {FACTORS.map((f) => (
          <div
            key={f.key}
            style={{ width: `${(((breakdown[f.key] ?? 0) * f.weight) / 500) * 100}%`, background: f.color }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 7 }}>
        {FACTORS.map((f) => (
          <span key={f.key} style={{ fontSize: 9, letterSpacing: ".09em", color: MUTE, fontWeight: 600 }}>
            <span style={{ color: f.color }}>■</span> {f.label} {breakdown[f.key] ?? 0}
          </span>
        ))}
        <span style={{ fontSize: 9, letterSpacing: ".09em", color: PAPER, fontWeight: 700, marginLeft: "auto" }}>
          {total}/500
        </span>
      </div>
    </div>
  );
}

export default function Page() {
  const [issues, setIssues] = useState([]);
  const [tab, setTab] = useState("queue");
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [listErr, setListErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [magicText, setMagicText] = useState("");
  const [magicBusy, setMagicBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  // Which predicted option is loaded into the shared box, if any — not a
  // separate editor per option anymore. Selecting one just populates this
  // one input; nothing else changes shape.
  const [selected, setSelected] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [olderOpen, setOlderOpen] = useState(false);
  const inputRef = useRef(null);
  // Which ticket is open right now. Async work started for one ticket must
  // never write its result into another — switching cards mid-poll is normal.
  const openId = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListErr(null);
    try {
      const r = await fetch("/api/issues");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setIssues(d.issues);
    } catch (e) {
      setListErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    openId.current = sel?.id || null;
    setDetail(null);
    setMsg(null);
    setAsking(false);
    setSelected(null);
    setMagicText("");
    setDetailsOpen(false);
    setOlderOpen(false);
    if (!sel) return;
    const id = sel.id;
    fetch(`/api/issue/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (openId.current !== id) return; // he moved on
        setDetail(d);
      })
      .catch((e) => {
        if (openId.current === id) setDetail({ error: e.message });
      });
  }, [sel?.id]);

  /* The lens selector — which system's output decides within-band order.
     Band is never part of this choice; it stays the fixed outer sort no
     matter what, because that is the layer that makes the queue predictable
     (Urgent always above High). The lens only changes how ties within a band
     are broken: by Routine 6's relative judgment, by 1B's raw weighted total,
     or by plain recency if neither exists yet.

     Options are discovered from the actual loaded data, not hardcoded, so a
     future second scoring or ranking system needs no UI change here — it
     just starts appearing as another option once it starts writing tagged
     comments. */
  const lenses = useMemo(() => discoverLenses(issues), [issues]);
  // Fixed initial value, never read from localStorage here — this page can
  // be statically prerendered at build time, when window does not exist.
  // Reading localStorage inside a useState initializer would make the
  // server-rendered HTML and the client's first paint disagree, which React
  // treats as a hydration error. Syncing after mount, in the effect below,
  // is the safe pattern for browser-only state in a page that isn't forced
  // dynamic.
  const [lensId, setLensId] = useState(null);
  useEffect(() => {
    const saved = window.localStorage.getItem("triage-lens");
    if (saved) setLensId(saved);
  }, []);
  const activeLens =
    lenses.find((l) => l.id === lensId) || lenses.find((l) => l.type === "rank") || lenses[0];

  function chooseLens(id) {
    setLensId(id);
    window.localStorage.setItem("triage-lens", id);
  }

  const inTab = issues
    .filter((i) => tabOf(i.labels) === tab)
    .sort((a, b) => {
      const band = (a.priority || 9) - (b.priority || 9);
      if (band !== 0) return band;
      return compareByLens(a, b, activeLens);
    });

  async function act(action, payload) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.id, action, payload }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMsg({ ok: true, text: d.message });
      load();
      // Re-read the open issue so labels and comments on screen match Linear.
      refreshDetail(sel.id).catch(() => {});
    } catch (e) {
      setMsg({ ok: false, text: `${e.message}. Nothing was changed.` });
    } finally {
      setBusy(false);
    }
  }

  async function refreshDetail(id) {
    const r = await fetch(`/api/issue/${id}`);
    const fresh = await r.json();
    if (openId.current !== id) return null; // a different card is open now
    setDetail(fresh);
    return fresh;
  }

  function growInput() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }
  function onMagicInput(e) {
    setMagicText(e.target.value);
    requestAnimationFrame(growInput);
  }

  /* Selecting a predicted option loads its draft into the ONE shared box —
     not a separate editor per option. This was a real, confirmed fix: an
     earlier version spawned its own editor per option, quietly
     reintroducing the second text surface the whole magic box exists to
     eliminate. */
  function selectOption(n, draftText) {
    setSelected(n);
    setMagicText(draftText || "");
    requestAnimationFrame(growInput);
  }
  function clearSelection() {
    setSelected(null);
    setMagicText("");
    requestAnimationFrame(growInput);
  }

  /* Confirming a SELECTED option is a known, already-classified action —
     it goes straight to the existing choose/EXEC path, never back through
     the classifier. Only free text (nothing selected) needs classifying. */
  async function sendFromBox() {
    if (selected != null) {
      const originalDraft = p?.drafts?.[String(selected)]?.text || "";
      const edited = magicText.trim() !== originalDraft.trim();
      const n = selected;
      const draftToSend = edited ? magicText : null;
      clearSelection();
      await act("choose", { n, draft: draftToSend });
      return;
    }
    await submitMagic();
  }

  /* Tapping a clarification choice is the same as typing it — goes through
     the same classification path, not a special case. */
  function answerClarify(choiceText) {
    setMagicText(choiceText);
    submitMagic(choiceText);
  }

  /* The magic box. Classify-then-execute already happened server-side by
     the time this returns — this just shows the result and, for a new
     option, lands straight on its editable draft rather than making a
     second click find it. */
  async function submitMagic(overrideText) {
    const text = (overrideText != null ? overrideText : magicText).trim();
    if (!text || !sel) return;
    setMagicText("");
    setMagicBusy(true);
    try {
      const r = await fetch("/api/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: sel.id, text }),
      });
      const result = await r.json();
      if (result.error) throw new Error(result.error);
      const fresh = await refreshDetail(sel.id);
      await load(); // labels may have changed (buddy-added-option, buddy-parked, buddy-done)

      if ((result.shape === "new_option" || result.shape === "modifier") && fresh?.parsed) {
        const n = result.newOptionNumber || result.modifiedOptionNumber;
        const d = fresh.parsed.drafts?.[String(n)];
        selectOption(n, d?.text || "");
      }
      if (result.shape === "needs_research") {
        // This is the actual fold-in of "Tell me more" into this one box —
        // a genuine question hands off to the real ask()/Routine 5 flow
        // instead of pointing at a separate button. Same polling UI that
        // already existed, just reached from here instead of its own entry
        // point.
        ask(text);
      }
    } catch (e) {
      setMsg({ ok: false, text: `Couldn't process that: ${e.message}` });
    } finally {
      setMagicBusy(false);
    }
  }

  /* Questions are answered by Routine 5, not by this app, so after asking we
     poll the ticket until the ANSWER comment appears. Up to two minutes,
     then we stop and tell the truth rather than spinning forever. */
  async function ask(q) {
    const id = sel.id;
    setAsking(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, question: q }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      await refreshDetail(id);

      if (!d.pending) {
        if (openId.current === id) setMsg({ ok: true, text: d.message });
        return;
      }

      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        if (openId.current !== id) return; // he moved on; stop quietly
        const fresh = await refreshDetail(id);
        if (fresh && !fresh.parsed?.awaitingAnswer) return;
      }
      if (openId.current === id)
        setMsg({ ok: true, text: "Still working. The answer appears on this card when it lands." });
    } catch (e) {
      if (openId.current === id) setMsg({ ok: false, text: e.message });
    } finally {
      if (openId.current === id) setAsking(false);
    }
  }

  const p = detail?.parsed;
  // One real timeline, not two stacked blocks. p.thread (Q&A) and
  // p.magicThread (everything else) merge and sort by real timestamp. No
  // overlap between the two sources: a genuine question only ever lands in
  // p.thread, since needs_research deliberately skips writing to
  // p.magicThread — see the magic route.
  const history = useMemo(() => {
    const rows = [];
    for (const t of p?.thread || []) {
      rows.push({
        at: t.at,
        who: t.role === "you" ? "You asked" : "Triage",
        you: t.role === "you",
        body: t.body || "What is this about, and does it matter to me?",
        sources: t.sources,
      });
    }
    for (const m of p?.magicThread || []) {
      const who = { you: "You", question: "Triage", resolved: "Resolved", snoozed: "Parked" }[m.kind] || m.kind;
      rows.push({ at: m.at, who, you: m.kind === "you", body: m.body, choices: m.choices || [], kind: m.kind });
    }
    return rows.sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [p?.thread, p?.magicThread]);

  // A clarification is pending only if the very last thing in the thread is
  // an unanswered question with choices. Answering it writes a newer entry,
  // which naturally clears this — no separate flag to keep in sync.
  const pendingClarify = useMemo(() => {
    const last = history[history.length - 1];
    return last && last.kind === "question" && last.choices?.length ? last : null;
  }, [history]);

  const RECENT = 3;
  const olderRows = history.slice(0, Math.max(0, history.length - RECENT));
  const recentRows = history.slice(Math.max(0, history.length - RECENT));
  const accent =
    tab === "proposals" || tab === "unsure" ? COOL : tab === "drops" ? INK_3 : detail?.issue?.priority === 1 ? ALERT : detail?.issue?.priority === 2 ? SIGNAL : LIVE;

  return (
    <main style={{ background: INK, color: PAPER, minHeight: "100vh", padding: "24px 20px 60px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 13, letterSpacing: ".28em", fontWeight: 700 }}>TRIAGE</h1>
          <span style={{ fontSize: 11.5, color: MUTE }}>
            {loading
              ? "Reading Linear…"
              : `${issues.filter((i) => ["queue", "unsure", "drops", "proposals"].includes(tabOf(i.labels))).length} open`}
          </span>
          <button onClick={load} style={{ ...btn("none", MUTE, `1px solid ${INK_3}`), marginLeft: "auto", padding: "5px 12px", fontSize: 11.5 }}>
            Refresh
          </button>
        </header>

        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const n = issues.filter((i) => tabOf(i.labels) === t.id).length;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setSel(null);
                }}
                style={{
                  background: on ? INK_2 : "transparent",
                  border: `1px solid ${on ? INK_3 : "transparent"}`,
                  borderRadius: 3,
                  color: on ? PAPER : MUTE,
                  padding: "7px 12px",
                  fontSize: 12.5,
                  cursor: "pointer",
                  fontWeight: on ? 600 : 400,
                }}
              >
                {t.label} <span style={{ color: on ? SIGNAL : MUTE, fontWeight: 700 }}>{n}</span>
              </button>
            );
          })}
        </nav>
        <p style={{ fontSize: 11.5, color: MUTE, margin: "6px 0 12px", paddingLeft: 12 }}>
          {TABS.find((t) => t.id === tab)?.hint}
        </p>

        {tab === "queue" && lenses.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingLeft: 12 }}>
            <span style={{ fontSize: 10.5, letterSpacing: ".08em", color: MUTE }}>ORDER WITHIN EACH PRIORITY BY</span>
            <select
              value={activeLens?.id || ""}
              onChange={(e) => chooseLens(e.target.value)}
              style={{
                background: INK_2,
                border: `1px solid ${INK_3}`,
                borderRadius: 3,
                color: PAPER,
                fontSize: 12,
                padding: "4px 8px",
                fontFamily: "inherit",
              }}
            >
              {lenses.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {listErr && (
          <div style={{ padding: 15, borderRadius: 4, background: "rgba(227,100,79,.1)", border: "1px solid rgba(227,100,79,.35)", color: ALERT, fontSize: 13 }}>
            {listErr}
            <div style={{ color: MUTE, marginTop: 6 }}>Check LINEAR_API_KEY and LINEAR_TEAM_KEY in your Vercel environment variables.</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: sel ? "minmax(240px, 360px) 1fr" : "1fr", gap: 14, alignItems: "start" }}>
          <div>
            {inTab.length === 0 && !loading && !listErr && (
              <p style={{ color: MUTE, fontSize: 13 }}>Nothing here. The routines run through the day.</p>
            )}
            {inTab.map((i) => {
              const on = sel?.id === i.id;
              return (
                <button
                  key={i.key}
                  onClick={() => setSel(i)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: on ? INK_3 : INK_2,
                    border: `1px solid ${INK_3}`,
                    borderLeft: `3px solid ${i.priority === 1 ? ALERT : i.priority === 2 ? SIGNAL : INK_3}`,
                    borderRadius: 4,
                    padding: "11px 13px",
                    marginBottom: 7,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: PAPER,
                  }}
                >
                  <span style={{ fontSize: 9.5, letterSpacing: ".1em", color: MUTE, fontWeight: 700 }}>{i.key}</span>
                  {i.rank && (
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: ".05em",
                        color: SIGNAL,
                        border: `1px solid ${SIGNAL}`,
                        borderRadius: 2,
                        padding: "1px 5px",
                        marginLeft: 6,
                      }}
                    >
                      {i.rank.position}/{i.rank.of}
                    </span>
                  )}
                  <div style={{ fontSize: 13, lineHeight: 1.4, marginTop: 4 }}>{i.title}</div>
                </button>
              );
            })}
          </div>

          {sel && (
            <article style={{ background: INK_2, border: `1px solid ${INK_3}`, borderLeft: `3px solid ${accent}`, borderRadius: 4, padding: "18px 20px", position: "sticky", top: 16 }}>
              {!detail && <p style={{ color: MUTE, fontSize: 13, margin: 0 }}>Reading {sel.key}…</p>}
              {detail?.error && <p style={{ color: ALERT, fontSize: 13 }}>{detail.error}</p>}

              {detail?.issue && (
                <>
                  <h1 className="td-h1">{detail.issue.title}</h1>

                  {/* The briefing — 1B's own context, as written. The one
                      accent at rest is the marker beside it. */}
                  <div className="td-state">
                    <div className="td-state-mark" />
                    <div className="td-state-text">{p?.context || "No context has been written for this ticket yet."}</div>
                  </div>

                  {/* Three quiet affordances, nothing louder. "Tell me more"
                      is first-class here, not buried in the input. */}
                  <div className="td-under">
                    <button className="td-quiet" disabled={asking} onClick={() => ask("")}>
                      {asking ? "Looking into it…" : "Tell me more"}
                    </button>
                    <button className="td-quiet" onClick={() => setDetailsOpen((v) => !v)}>
                      {detailsOpen ? "Hide" : "Why it's ranked here"}
                    </button>
                    <a className="td-quiet" href={detail.issue.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      Open in Linear ↗
                    </a>
                  </div>

                  <div className={`td-details ${detailsOpen ? "open" : ""}`}>
                    <div className="td-labels">
                      <span className="td-label">{detail.issue.key}</span>
                      {detail.issue.labels.map((l) => (
                        <span key={l} className="td-label">{l}</span>
                      ))}
                    </div>
                    <Spine breakdown={p?.breakdown} total={p?.score} />
                    {p?.rank && (
                      <div className="td-rank">
                        {p.rank.position} of {p.rank.of} in {p.rank.band}
                        {p.rank.reason ? ` — ${p.rank.reason}` : ""}
                      </div>
                    )}
                  </div>

                  {/* The thread — a real conversation, visible. Recent
                      exchanges show; older ones fold above. */}
                  {(history.length > 0 || magicBusy) && (
                    <div className="td-thread">
                      {olderRows.length > 0 && (
                        <>
                          <button className="td-earlier" onClick={() => setOlderOpen((v) => !v)}>
                            {olderOpen ? "Hide earlier" : `Earlier in this thread (${olderRows.length})`}
                          </button>
                          <div className={`td-older ${olderOpen ? "open" : ""}`}>
                            {olderRows.map((r, i) => <Msg key={`o${i}`} r={r} />)}
                          </div>
                        </>
                      )}
                      {recentRows.map((r, i) => <Msg key={`r${i}`} r={r} />)}
                      {magicBusy && (
                        <div className="td-msg td-working">
                          <div className="td-msg-who">Triage</div>
                          <div className="td-msg-body">Working on that…</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* One action zone. A pending clarification takes it over;
                      otherwise it shows whatever this tab can do. Nothing
                      clickable lives anywhere else. */}
                  <div className="td-bottom">
                    {pendingClarify ? (
                      <>
                        <div className="td-opts-note">Choose one</div>
                        {pendingClarify.choices.map((c) => (
                          <button key={c} className="td-chip-action" disabled={magicBusy} onClick={() => answerClarify(c)}>
                            {c}
                          </button>
                        ))}
                      </>
                    ) : tab === "proposals" ? (
                      <div style={{ padding: "10px 0" }}>
                        <button className="td-chip-action" disabled={busy} onClick={() => act("proposal", { approve: true })}>
                          Approve
                        </button>
                        <button className="td-chip-action" disabled={busy} onClick={() => act("proposal", { approve: false })}>
                          Not yet
                        </button>
                      </div>
                    ) : tab === "drops" || tab === "unsure" ? (
                      <>
                        <div className="td-opts-note">{tab === "unsure" ? "Which bucket" : "Was this right"}</div>
                        {BUCKETS.map((b) => (
                          <button key={b.id} className="td-chip-action" disabled={busy} onClick={() => act("bucket", { bucket: b.id })}>
                            {b.label}
                          </button>
                        ))}
                      </>
                    ) : p?.options?.length > 0 ? (
                      p.options.map((o, i) => {
                        const d = p.drafts?.[String(o.n)];
                        return (
                          <button
                            key={o.n}
                            className={`td-opt ${selected === o.n ? "selected" : ""}`}
                            disabled={busy}
                            onClick={() => (selected === o.n ? clearSelection() : selectOption(o.n, d?.text || ""))}
                          >
                            <span className="n">{i + 1}</span>
                            <span>
                              {o.text}
                              {o.manual && <span className="manual-tag">MANUAL</span>}
                            </span>
                          </button>
                        );
                      })
                    ) : null}

                    {selected != null && (
                      <div className="td-context">
                        {p?.drafts?.[String(selected)] ? (
                          <>Editing: <span className="to">{p.options.find((x) => x.n === selected)?.text}</span> — send when ready</>
                        ) : (
                          <>Confirming: <span className="to">{p.options.find((x) => x.n === selected)?.text}</span> — records the choice, sends nothing</>
                        )}
                        <button onClick={clearSelection}>not this</button>
                      </div>
                    )}

                    <div className="td-input-wrap">
                      <textarea
                        ref={inputRef}
                        className="td-input"
                        rows={1}
                        placeholder="Reply, delegate, ask, or leave a note"
                        value={magicText}
                        onChange={onMagicInput}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendFromBox();
                        }}
                      />
                      <button
                        className={`td-send ${magicText.trim() || selected != null ? "show" : ""}`}
                        disabled={busy || magicBusy}
                        onClick={sendFromBox}
                        aria-label="Send"
                      >
                        ↑
                      </button>
                    </div>

                    {msg && (
                      <div
                        style={{
                          marginTop: 12,
                          fontSize: 13,
                          color: msg.ok ? "var(--live)" : "var(--alert)",
                          lineHeight: 1.5,
                        }}
                      >
                        {msg.text}
                      </div>
                    )}
                  </div>
                </>
              )}
            </article>
          )}
        </div>
      </div>
    </main>
  );
}
