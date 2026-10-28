import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import Brand from "../components/Brand.jsx";
import { useAuth } from "../auth.jsx";
import "./report.css";

/* ---------- Default data (replace with props / API response) ---------- */
const DEFAULT_REPORT = {
  id: "daniel-okafor-2026-10-26", // used as the storage key for the saved decision
  candidate: "Daniel Okafor",
  role: "Office Administrator",
  interviewed: "Mon 26 Oct",
  generatedBy: "Gemini",
  generatedAt: "26 Oct, 16:05",
  suggestion: {
    label: "Move to next stage",
    note: "Follow up on H&S and new-starter setup",
  },
  evidence: { level: "Medium", note: "2 answers were short on detail" },
  summary:
    "Daniel gave practical, specific answers on diary management and records, with clear examples from his current role. His confidentiality answers were the strongest of the interview. New-starter setup was described at a high level only, and basic health & safety wasn’t covered, so both need follow-up before an offer.",
  scores: [
    { area: "Scheduling & diary", score: 4.5 },
    { area: "Records management", score: 4.5 },
    { area: "MS Word & Excel", score: 4 },
    { area: "Confidentiality", score: 5 },
    { area: "Communication", score: 4 },
    { area: "New-starter setup", score: 3 },
    { area: "Basic H&S", score: null }, // null = not covered
  ],
  strengths: [
    {
      title: "Organised diary management",
      text: "Manages calendars for four managers with a clear priority system.",
      quote: "I colour-code by priority and confirm anything external 24 hours ahead.",
      q: "Q1",
    },
    {
      title: "Handles confidential information well",
      text: "Need-to-know approach; secure handover and storage.",
      quote: "I hand it over in person or send it password-protected.",
      q: "Q8",
    },
  ],
  concerns: [
    {
      title: "New-starter setup was thin",
      text: "Mentioned desk and reception only; no IT accounts, equipment or induction.",
      ask: "Ask: “Walk me through everything a new starter needs on day one.”",
    },
    {
      title: "Basic H&S not covered",
      text: "Question 7 wasn’t asked in the interview.",
      ask: "Ask about fire evacuation and reporting an accident.",
    },
  ],
  questions: [
    { q: "Q1", area: "Scheduling & diary", score: 5, said: "Four managers’ calendars, priority colour-coding, confirms external meetings a day ahead." },
    { q: "Q2", area: "Scheduling & diary", score: 4, said: "Resolves clashes by deadline and offers alternatives; keeps both managers informed." },
    { q: "Q3", area: "Records management", score: 4, said: "Set up a shared-drive naming convention; logs paper files with retention dates." },
    { q: "Q4", area: "Records management", score: 5, said: "Locked storage for personal files and a clear retention process." },
    { q: "Q5", area: "New-starter setup", score: 3, said: "Desk and reception only; no mention of IT access, equipment or induction." },
    { q: "Q6", area: "MS Word & Excel", score: 4, said: "Uses mail merge and pivot tables for monthly reporting." },
    { q: "Q7", area: "Basic H&S", score: null, said: "Not asked." },
    { q: "Q8", area: "Confidentiality", score: 5, said: "Need-to-know approach; hands over in person or password-protected." },
    { q: "Q9", area: "Communication", score: 4, said: "Adapts tone for senior staff and external visitors; confirms in writing." },
    { q: "Q10", area: "Communication", score: 4, said: "Gives a clear, calm account of handling a complaint." },
  ],
  // Optional. Replace with the real transcript from your backend.
  transcript: [
    { speaker: "Interviewer", time: "00:00", text: "Thanks for joining, Daniel. Let’s start with how you manage diaries today." },
    { speaker: "Daniel", time: "00:12", text: "I manage calendars for four managers. I colour-code by priority and confirm anything external 24 hours ahead." },
    { speaker: "Interviewer", time: "03:40", text: "How do you handle confidential information?" },
    { speaker: "Daniel", time: "03:52", text: "I work on a need-to-know basis. I hand it over in person or send it password-protected." },
    { speaker: "Interviewer", time: "07:15", text: "What does a new starter need on their first day?" },
    { speaker: "Daniel", time: "07:28", text: "A desk and someone to meet them at reception." },
  ],
};

const DECISIONS = [
  { value: "offer", label: "Move to offer" },
  { value: "another", label: "Another interview" },
  { value: "reject", label: "Do not progress" },
];

/* ---------- Small helpers ---------- */
const barClass = (score) => (score >= 4 ? "is-strong" : "is-mid");

const storageKey = (id) => `whosnext:report-decision:${id}`;

function readSavedDecision(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSavedDecision(id, value) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(value));
  } catch {
    /* storage unavailable: ignore, the in-memory state still works */
  }
}

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/* ---------- Transcript modal ---------- */
function TranscriptModal({ report, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = report.transcript || [];

  return (
    <div className="rp-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="rp-modal__card" role="dialog" aria-modal="true" aria-labelledby="rp-tr-title">
        <div className="rp-modal__head">
          <div>
            <h2 id="rp-tr-title" className="rp-h2">Interview transcript</h2>
            <p className="rp-sub">{report.candidate} · {report.role} · {report.interviewed}</p>
          </div>
          <button type="button" className="rp-pill rp-pill--sm" onClick={onClose} aria-label="Close transcript">
            Close
          </button>
        </div>

        <div className="rp-modal__body">
          {lines.length === 0 ? (
            <p className="rp-sub">No transcript is available for this interview.</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="rp-line">
                <div className="rp-line__meta">
                  <b>{l.speaker}</b>
                  {l.time && <span>{l.time}</span>}
                </div>
                <p>{l.text}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------- Page ---------- */
export default function Report({
  report = DEFAULT_REPORT,
  onSaveDecision, // optional async ({ reportId, decision, reason }) => void  (e.g. write to Firestore)
  onDownload, // optional override; defaults to the browser's print dialog (Save as PDF)
  onShare, // optional override; defaults to Web Share / copy link
  onViewTranscript, // optional override; defaults to the built-in transcript modal
}) {
  const { user, signOut } = useAuth();
  const initials = (user?.name || "U").slice(0, 2).toUpperCase();

  const reportId = report.id || `${report.candidate}-${report.interviewed}`;

  const [showAll, setShowAll] = useState(false);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(null); // { decision, reason, savedAt } | null
  const [saving, setSaving] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [toast, setToast] = useState("");

  /* Restore a previously saved decision for this report */
  useEffect(() => {
    const prev = readSavedDecision(reportId);
    if (prev) {
      setSaved(prev);
      setDecision(prev.decision);
      setReason(prev.reason || "");
    } else {
      setSaved(null);
      setDecision("");
      setReason("");
    }
  }, [reportId]);

  /* Auto-hide toast */
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  /* Values calculated from the data, so they stay correct for any report */
  const stats = useMemo(() => {
    const scored = report.scores.filter((s) => s.score != null);
    const overall = scored.length
      ? scored.reduce((sum, s) => sum + s.score, 0) / scored.length
      : 0;
    const missing = report.questions.filter((q) => q.score == null);
    return {
      overall,
      scoredAreas: scored.length,
      asked: report.questions.length - missing.length,
      total: report.questions.length,
      coverageNote: missing.length
        ? `${missing.map((m) => `${m.q} ${m.area}`).join(", ")} not asked`
        : "All planned questions were asked",
    };
  }, [report]);

  const rows = showAll ? report.questions : report.questions.slice(0, 5);

  /* ---------- Actions ---------- */
  const handleDownload = useCallback(() => {
    if (onDownload) return onDownload(report);
    // Browser print dialog: choose "Save as PDF". Print styles are in report-additions.css.
    const prevTitle = document.title;
    document.title = `Interview report - ${report.candidate}`;
    window.print();
    document.title = prevTitle;
    return undefined;
  }, [onDownload, report]);

  const handleShare = useCallback(async () => {
    if (onShare) return onShare(report);
    const url = window.location.href;
    const title = `Interview report: ${report.candidate}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${report.candidate} · ${report.role}`, url });
        return undefined;
      }
      await navigator.clipboard.writeText(url);
      setToast("Report link copied");
    } catch (err) {
      if (err?.name === "AbortError") return undefined; // user closed the share sheet
      try {
        // Fallback for browsers/contexts without the Clipboard API
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setToast("Report link copied");
      } catch {
        setToast("Could not copy the link");
      }
    }
    return undefined;
  }, [onShare, report]);

  const handleTranscript = useCallback(() => {
    if (onViewTranscript) return onViewTranscript(report);
    setShowTranscript(true);
    return undefined;
  }, [onViewTranscript, report]);

  const handleSave = async () => {
    if (!decision || saving) return;
    setSaving(true);
    const record = { decision, reason: reason.trim(), savedAt: new Date().toISOString() };
    try {
      await onSaveDecision?.({ reportId, decision, reason: record.reason });
      writeSavedDecision(reportId, record);
      setSaved(record);
      setToast("Decision saved");
    } catch (err) {
      console.error("Could not save decision:", err);
      setToast("Could not save the decision. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const savedLabel = saved ? DECISIONS.find((d) => d.value === saved.decision)?.label : "";
  const isUnchanged = saved && saved.decision === decision && saved.reason === reason.trim();

  return (
    <div className="shell">
      {/* Same top bar as Jobs / Candidates / Screening pages */}
      <header className="topbar glass glass--strong">
        <Brand />
        <nav>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/candidates">Candidates</NavLink>
          <NavLink to="/screening">Screening</NavLink>
          <NavLink to="/interviews">Interviews</NavLink>
          <NavLink to="/reports">Reports</NavLink>
        </nav>
        <span className="spacer" />
        <NavLink to="/profile" className="avatar" title={user?.email}>{initials}</NavLink>
        <button className="btn btn--ghost" onClick={signOut}>Log out</button>
      </header>

      <main className="page rp-page">
        <div className="rp-container">
          {/* Breadcrumb */}
          <nav className="rp-crumbs" aria-label="Breadcrumb">
            <Link to="/interviews">Interviews</Link> / <span>{report.candidate}</span> / <span>Report</span>
          </nav>

          {/* Header */}
          <header className="rp-header">
            <div className="rp-header__text">
              <div className="rp-title-row">
                <h1 className="rp-title">Final interview report</h1>
                <span className="rp-status">
                  <i className={`rp-status__dot ${saved ? "is-done" : ""}`} />
                  {saved ? `Decision: ${savedLabel}` : "Awaiting your decision"}
                </span>
              </div>
              <p className="rp-meta">
                {report.candidate} · {report.role} · Interviewed {report.interviewed} · Report generated by{" "}
                {report.generatedBy} {report.generatedAt}
              </p>
            </div>

            <div className="rp-actions">
              <button type="button" className="rp-pill" onClick={handleDownload}>
                <Icon d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" /> Download PDF
              </button>
              <button type="button" className="rp-pill" onClick={handleShare}>
                <Icon d="M12 15V3m0 0L8 7m4-4l4 4M5 12v7h14v-7" /> Share
              </button>
              <button type="button" className="rp-pill" onClick={handleTranscript}>
                View transcript
              </button>
            </div>
          </header>

          {/* KPI cards */}
          <section className="rp-kpis">
            <div className="rp-card rp-kpi">
              <span className="rp-kpi__label">Overall score</span>
              <span className="rp-kpi__big">
                {stats.overall.toFixed(1)}
                <small> / 5</small>
              </span>
              <span className="rp-kpi__note">Average of {stats.scoredAreas} scored areas</span>
            </div>

            <div className="rp-card rp-kpi rp-kpi--ai">
              <span className="rp-kpi__label">
                AI suggestion <em className="rp-badge">Advisory</em>
              </span>
              <span className="rp-kpi__mid rp-text-mint">{report.suggestion.label}</span>
              <span className="rp-kpi__note">{report.suggestion.note}</span>
            </div>

            <div className="rp-card rp-kpi">
              <span className="rp-kpi__label">Plan coverage</span>
              <span className="rp-kpi__big">
                {stats.asked}
                <small> / {stats.total} questions</small>
              </span>
              <span className="rp-kpi__note">{stats.coverageNote}</span>
            </div>

            <div className="rp-card rp-kpi">
              <span className="rp-kpi__label">Evidence strength</span>
              <span className="rp-kpi__mid">{report.evidence.level}</span>
              <span className="rp-kpi__note">{report.evidence.note}</span>
            </div>
          </section>

          {/* Summary */}
          <section className="rp-card rp-pad">
            <h2 className="rp-h2">Summary</h2>
            <p className="rp-summary">{report.summary}</p>
          </section>

          {/* Scores + Strengths / Concerns */}
          <section className="rp-grid">
            <div className="rp-card rp-pad rp-scores">
              <h2 className="rp-h2">Scores by area</h2>
              <ul className="rp-score-list">
                {report.scores.map((s) => (
                  <li key={s.area} className="rp-score">
                    <div className="rp-score__row">
                      <span>{s.area}</span>
                      {s.score == null ? (
                        <span className="rp-score__na">Not covered</span>
                      ) : (
                        <span className="rp-score__val">{s.score} / 5</span>
                      )}
                    </div>
                    <div
                      className="rp-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={5}
                      aria-valuenow={s.score ?? 0}
                      aria-label={s.area}
                    >
                      <span
                        className={`rp-bar__fill ${s.score == null ? "is-na" : barClass(s.score)}`}
                        style={{ width: s.score == null ? "4%" : `${(s.score / 5) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="rp-scale">Scale: 1 = no evidence · 3 = meets the role · 5 = strong, with examples</p>
            </div>

            <div className="rp-stack">
              <div className="rp-card rp-pad">
                <h2 className="rp-h2 rp-text-mint">Strengths</h2>
                {report.strengths.map((s) => (
                  <article key={s.title} className="rp-item">
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                    <blockquote className="rp-quote">
                      “{s.quote}” <span>{s.q}</span>
                    </blockquote>
                  </article>
                ))}
              </div>

              <div className="rp-card rp-pad rp-card--warn">
                <h2 className="rp-h2 rp-text-amber">Concerns &amp; follow-ups</h2>
                {report.concerns.map((c) => (
                  <article key={c.title} className="rp-item">
                    <h3>{c.title}</h3>
                    <p>{c.text}</p>
                    <p className="rp-ask">{c.ask}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* Question by question */}
          <section className="rp-card rp-pad">
            <div className="rp-qhead">
              <h2 className="rp-h2">Question by question</h2>
              <button type="button" className="rp-pill rp-pill--sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show less" : `Show all ${report.questions.length}`}
              </button>
            </div>

            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Q</th>
                    <th>Area</th>
                    <th>Score</th>
                    <th>What they said</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.q}>
                      <td className="rp-table__q">{r.q}</td>
                      <td>{r.area}</td>
                      <td className="rp-table__score">{r.score == null ? "—" : `${r.score} / 5`}</td>
                      <td className="rp-table__said">{r.said}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Decision */}
          <section className="rp-card rp-card--decision rp-pad rp-no-print">
            <h2 className="rp-h2">Your decision</h2>
            <p className="rp-sub">AI scores are advisory. The decision and your reasons are saved under your name.</p>

            <div className="rp-radios" role="radiogroup" aria-label="Decision">
              {DECISIONS.map((d) => (
                <label key={d.value} className={`rp-radio ${decision === d.value ? "is-on" : ""}`}>
                  <input
                    type="radio"
                    name="decision"
                    value={d.value}
                    checked={decision === d.value}
                    onChange={() => setDecision(d.value)}
                  />
                  <span className="rp-radio__dot" />
                  {d.label}
                </label>
              ))}
            </div>

            <label className="rp-label" htmlFor="rp-reason">Reason</label>
            <textarea
              id="rp-reason"
              className="rp-textarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Strong on core admin. Book a short call to cover H&S and new-starter setup before offer."
            />

            <div className="rp-save-row">
              <button
                type="button"
                className="rp-save"
                onClick={handleSave}
                disabled={!decision || saving || Boolean(isUnchanged)}
              >
                {saving ? "Saving…" : isUnchanged ? "Decision saved" : saved ? "Update decision" : "Save decision"}
              </button>
              {saved && (
                <span className="rp-saved-note">
                  Saved {new Date(saved.savedAt).toLocaleString(undefined, {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                  {user?.name ? ` by ${user.name}` : ""}
                </span>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="footer">Who’s Next assists interviewers. Hiring decisions stay with you.</footer>

      {showTranscript && <TranscriptModal report={report} onClose={() => setShowTranscript(false)} />}
      {toast && <div className="rp-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}