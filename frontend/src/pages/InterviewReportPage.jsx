import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { DECISIONS, INTERVIEW_STATUS, interviewStatusKey } from '../constants/statuses.js'
import {
  generateFinalReport,
  interviewErrorMessage,
  saveHiringDecision,
  subscribeToInterview,
  subscribeToReport,
  subscribeToTranscript,
} from '../services/interviews.js'
import { formatDate, formatDateTime } from '../utils/format.js'
import './report.css'

const barClass = score => (score >= 4 ? 'is-strong' : 'is-mid')

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

function transcriptLines(text) {
  return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^([^:]{1,40}):\s*(.*)$/)
    return match ? { speaker: match[1], text: match[2] } : { speaker: '', text: line }
  })
}

function TranscriptModal({ title, subtitle, transcript, onClose }) {
  useEffect(() => {
    const onKey = event => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lines = transcriptLines(transcript)

  return (
    <div className="rp-modal" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="rp-modal__card" role="dialog" aria-modal="true" aria-labelledby="rp-tr-title">
        <div className="rp-modal__head">
          <div>
            <h2 id="rp-tr-title" className="rp-h2">{title}</h2>
            <p className="rp-sub">{subtitle}</p>
          </div>
          <button type="button" className="rp-pill rp-pill--sm" onClick={onClose} aria-label="Close transcript">Close</button>
        </div>
        <div className="rp-modal__body">
          {lines.length === 0 ? <p className="rp-sub">No transcript is available for this interview.</p> : lines.map((line, index) => (
            <div key={index} className="rp-line">
              {line.speaker && <div className="rp-line__meta"><b>{line.speaker}</b></div>}
              <p>{line.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Shell({ children }) {
  return (
    <AppLayout mainClassName="page rp-page">
      <div className="rp-container">{children}</div>
    </AppLayout>
  )
}

export default function InterviewReportPage() {
  const { interviewId } = useParams()
  const { user } = useAuth()
  const [interview, setInterview] = useState(null)
  const [report, setReport] = useState(undefined)
  const [transcript, setTranscript] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [formReady, setFormReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!user?.uid || !interviewId) return undefined
    const stops = [
      subscribeToInterview(user.uid, interviewId, {
        onChange: setInterview,
        onMissing: () => setLoadError('This interview could not be found.'),
        onError: () => setLoadError('Could not load this interview. Please try again.'),
      }),
      subscribeToReport(interviewId, setReport, error => {
        console.error('Could not load the report:', error)
        setReport(null)
      }),
      subscribeToTranscript(interviewId, data => setTranscript(data?.transcript || ''), () => setTranscript('')),
    ]
    return () => stops.forEach(stop => stop())
  }, [interviewId, user?.uid])

  // Pre-fill the decision form from the saved decision once.
  useEffect(() => {
    if (formReady || report === undefined) return
    if (report?.decision) {
      setDecision(report.decision.value)
      setReason(report.decision.reason || '')
    }
    setFormReady(true)
  }, [report, formReady])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  const handleShare = useCallback(async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setToast('Link copied — only you can open it while signed in')
    } catch {
      setToast('Could not copy the link')
    }
  }, [])

  const handleDownload = useCallback(() => {
    const previousTitle = document.title
    document.title = `Interview report - ${report?.candidateName || 'candidate'}`
    window.print()
    document.title = previousTitle
  }, [report?.candidateName])

  const rows = useMemo(() => {
    const questions = report?.questions || []
    return showAll ? questions : questions.slice(0, 6)
  }, [report?.questions, showAll])

  if (loadError) {
    return (
      <Shell>
        <div className="workflow-notice" role="alert"><b>Report unavailable</b><span>{loadError}</span><Link className="btn btn--small" to="/reports">All reports</Link></div>
      </Shell>
    )
  }

  if (!interview || report === undefined) {
    return <Shell><p className="rp-sub">Loading report…</p></Shell>
  }

  const status = interviewStatusKey(interview.status)

  if (!report) {
    const canGenerate = status === INTERVIEW_STATUS.TRANSCRIPT_SUBMITTED
    const running = generating || interview.reportGeneration?.status === 'running'
    const generate = async () => {
      setGenerating(true)
      try {
        await generateFinalReport(interviewId)
      } catch (error) {
        setToast(interviewErrorMessage(error, 'The report could not be generated.'))
      } finally {
        setGenerating(false)
      }
    }
    return (
      <Shell>
        <div className="workflow-notice" role="note">
          <b>No final report yet</b>
          <span>{canGenerate ? 'The transcript is saved. Generate the report to see scores and evidence.' : 'Add the interview transcript first.'}</span>
          {canGenerate ? (
            <button type="button" className="btn btn--small btn--primary" onClick={generate} disabled={running}>{running ? 'Generating…' : 'Generate report'}</button>
          ) : (
            <Link className="btn btn--small" to={`/interviews/${interviewId}/transcript`}>Add transcript</Link>
          )}
        </div>
        {toast && <div className="rp-toast" role="status" aria-live="polite">{toast}</div>}
      </Shell>
    )
  }

  const saved = report.decision
  const savedLabel = saved ? DECISIONS.find(item => item.value === saved.value)?.label : ''
  const unchanged = saved && saved.value === decision && (saved.reason || '') === reason.trim()
  const notAsked = report.questions.filter(question => !question.asked)
  const scoredAreas = report.areaScores.filter(area => area.score !== null)

  const handleSave = async () => {
    if (!decision || saving) return
    setSaving(true)
    try {
      await saveHiringDecision(interviewId, decision, reason.trim())
      setToast('Decision saved')
    } catch (error) {
      setToast(interviewErrorMessage(error, 'Could not save the decision. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Shell>
      <nav className="rp-crumbs" aria-label="Breadcrumb">
        <Link to="/reports">Reports</Link> / <span>{report.candidateName}</span> / <span>Final report</span>
      </nav>

      <header className="rp-header">
        <div className="rp-header__text">
          <div className="rp-title-row">
            <h1 className="rp-title">Final interview report</h1>
            <span className="rp-status">
              <i className={`rp-status__dot ${saved ? 'is-done' : ''}`} />
              {saved ? `Decision: ${savedLabel}` : 'Awaiting your decision'}
            </span>
          </div>
          <p className="rp-meta">
            {report.candidateName} · {report.role || report.jobTitle}{report.round > 1 ? ` · Round ${report.round}` : ''} · Transcript added {formatDate(report.interviewedAt)} · Report generated by {report.model || 'Gemini'} {formatDateTime(report.generatedAt)}
          </p>
        </div>
        <div className="rp-actions rp-no-print">
          <button type="button" className="rp-pill" onClick={handleDownload}><Icon d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" /> Download PDF</button>
          <button type="button" className="rp-pill" onClick={handleShare}><Icon d="M12 15V3m0 0L8 7m4-4l4 4M5 12v7h14v-7" /> Copy link</button>
          <button type="button" className="rp-pill" onClick={() => setShowTranscript(true)}>View transcript</button>
        </div>
      </header>

      <section className="rp-kpis">
        <div className="rp-card rp-kpi">
          <span className="rp-kpi__label">Overall score</span>
          <span className="rp-kpi__big">{report.overallScore == null ? '–' : report.overallScore.toFixed(1)}<small> / 5</small></span>
          <span className="rp-kpi__note">Average of {scoredAreas.length} scored area{scoredAreas.length === 1 ? '' : 's'}</span>
        </div>
        <div className="rp-card rp-kpi rp-kpi--ai">
          <span className="rp-kpi__label">AI suggestion <em className="rp-badge">Advisory</em></span>
          <span className="rp-kpi__mid rp-text-mint">{report.suggestion.label}</span>
          <span className="rp-kpi__note">{report.suggestion.note}</span>
        </div>
        <div className="rp-card rp-kpi">
          <span className="rp-kpi__label">Plan coverage</span>
          <span className="rp-kpi__big">{report.askedQuestions}<small> / {report.plannedQuestions} questions</small></span>
          <span className="rp-kpi__note">{notAsked.length ? `${notAsked.map(question => `Q${question.number}`).join(', ')} not asked` : 'All planned questions were asked'}</span>
        </div>
        <div className="rp-card rp-kpi">
          <span className="rp-kpi__label">Evidence strength</span>
          <span className="rp-kpi__mid">{report.evidenceStrength.level}</span>
          <span className="rp-kpi__note">{report.evidenceStrength.note}</span>
        </div>
      </section>

      <section className="rp-card rp-pad">
        <h2 className="rp-h2">Summary</h2>
        <p className="rp-summary">{report.summary}</p>
      </section>

      <section className="rp-grid">
        <div className="rp-card rp-pad rp-scores">
          <h2 className="rp-h2">Scores by area</h2>
          <ul className="rp-score-list">
            {report.areaScores.map(area => (
              <li key={area.area} className="rp-score">
                <div className="rp-score__row">
                  <span>{area.area}</span>
                  {area.score == null ? <span className="rp-score__na">Not covered</span> : <span className="rp-score__val">{area.score} / 5</span>}
                </div>
                <div className="rp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={area.score ?? 0} aria-label={area.area}>
                  <span className={`rp-bar__fill ${area.score == null ? 'is-na' : barClass(area.score)}`} style={{ width: area.score == null ? '4%' : `${(area.score / 5) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="rp-scale">Scale: 1 = no evidence · 3 = meets the role · 5 = strong, with examples</p>
        </div>

        <div className="rp-stack">
          <div className="rp-card rp-pad">
            <h2 className="rp-h2 rp-text-mint">Strengths</h2>
            {report.strengths.length === 0 ? <p className="rp-sub">No specific strengths were identified.</p> : report.strengths.map(item => (
              <article key={item.title} className="rp-item">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                {item.quote && <blockquote className="rp-quote">“{item.quote}” {item.questionNumber && <span>Q{item.questionNumber}</span>}</blockquote>}
              </article>
            ))}
          </div>
          <div className="rp-card rp-pad rp-card--warn">
            <h2 className="rp-h2 rp-text-amber">Concerns &amp; follow-ups</h2>
            {report.concerns.length === 0 ? <p className="rp-sub">No specific concerns were identified.</p> : report.concerns.map(item => (
              <article key={item.title} className="rp-item">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                {item.followUpQuestion && <p className="rp-ask">Ask: “{item.followUpQuestion}”</p>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rp-card rp-pad">
        <div className="rp-qhead">
          <h2 className="rp-h2">Question by question</h2>
          {report.questions.length > 6 && (
            <button type="button" className="rp-pill rp-pill--sm rp-no-print" onClick={() => setShowAll(value => !value)}>
              {showAll ? 'Show less' : `Show all ${report.questions.length}`}
            </button>
          )}
        </div>
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th>Q</th><th>Area</th><th>Score</th><th>What they said</th></tr></thead>
            <tbody>
              {rows.map(question => (
                <tr key={question.questionId || question.number}>
                  <td className="rp-table__q">Q{question.number}</td>
                  <td>{question.topic}</td>
                  <td className="rp-table__score">{question.score == null ? (question.asked ? 'n/s' : '—') : `${question.score} / 5`}</td>
                  <td className="rp-table__said">
                    {question.evidence}
                    {question.quote && <span className="rp-table__quote">“{question.quote}”</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rp-scale">n/s = asked but not scorable. Quotes are shown only when they match the transcript word for word.</p>
      </section>

      <section className="rp-card rp-card--decision rp-pad rp-no-print">
        <h2 className="rp-h2">Your decision</h2>
        <p className="rp-sub">AI scores are advisory. Your decision and reason are saved with your name, and the candidate’s stage is updated.</p>

        <div className="rp-radios" role="radiogroup" aria-label="Decision">
          {DECISIONS.map(item => (
            <label key={item.value} className={`rp-radio ${decision === item.value ? 'is-on' : ''}`}>
              <input type="radio" name="decision" value={item.value} checked={decision === item.value} onChange={() => setDecision(item.value)} />
              <span className="rp-radio__dot" />
              {item.label}
            </label>
          ))}
        </div>

        <label className="rp-label" htmlFor="rp-reason">Reason</label>
        <textarea id="rp-reason" className="rp-textarea" rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Strong on the core skills. Book a short call to cover the gaps before an offer." />

        <div className="rp-save-row">
          <button type="button" className="rp-save" onClick={handleSave} disabled={!decision || saving || Boolean(unchanged)}>
            {saving ? 'Saving…' : unchanged ? 'Decision saved' : saved ? 'Update decision' : 'Save decision'}
          </button>
          {saved && <span className="rp-saved-note">Saved {formatDateTime(saved.decidedAt)} by {saved.decidedByName || 'you'}</span>}
        </div>

        {decision === 'another' && saved?.value === 'another' && (
          <p className="rp-sub">To plan the next round, open the candidate’s screening and choose “Advance to interview” again.</p>
        )}

        {Array.isArray(report.decisionHistory) && report.decisionHistory.length > 1 && (
          <details className="rp-history">
            <summary>Decision history ({report.decisionHistory.length})</summary>
            <ol>
              {[...report.decisionHistory].reverse().map((entry, index) => (
                <li key={index}>
                  <b>{entry.label}</b> · {formatDateTime(entry.decidedAt)} · {entry.decidedByName}
                  {entry.reason && <p>{entry.reason}</p>}
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      {showTranscript && (
        <TranscriptModal
          title="Interview transcript"
          subtitle={`${report.candidateName} · ${report.jobTitle}`}
          transcript={transcript}
          onClose={() => setShowTranscript(false)}
        />
      )}
      {toast && <div className="rp-toast" role="status" aria-live="polite">{toast}</div>}
    </Shell>
  )
}
