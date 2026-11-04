import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import {
  AI_SUGGESTIONS,
  DECISIONS,
  markReportViewed,
  saveReportDecision,
  subscribeToReport,
} from '../services/reports.js'
import { scoreTone } from './report.jsx'
import './report.css'

function formatLong(timestamp) {
  if (!timestamp?.toDate) return ''
  const d = timestamp.toDate()
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return `${date}, ${time}`
}

function formatInterviewed(timestamp) {
  if (!timestamp?.toDate) return ''
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(timestamp.toDate())
}

const scoreText = score => (Number.isInteger(score) ? `${score}` : score.toFixed(1))

function buildReportText(report) {
  const lines = [
    `Final interview report: ${report.candidateName} (${report.jobTitle})`,
    `Overall score: ${report.overallScore ?? '—'} / 5`,
    `AI suggestion: ${AI_SUGGESTIONS[report.aiSuggestion] || '—'} (advisory)`,
    '',
    report.summary || '',
    '',
    'Scores by area:',
    ...(report.areas || []).map(a => `- ${a.name}: ${a.covered === false ? 'Not covered' : `${a.score} / 5`}`),
  ]
  return lines.join('\n')
}

export default function ReportDetailPage() {
  // Opened as /reports/:reportId, or /interviews/:interviewId/reports/:candidateId
  // (in that case the report document id is the interview id).
  const { reportId: paramReportId, interviewId } = useParams()
  const reportId = paramReportId || interviewId
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [report, setReport] = useState(undefined)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [choice, setChoice] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [shareNote, setShareNote] = useState('')
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (!user?.uid || !reportId) return undefined
    return subscribeToReport(
      user.uid,
      reportId,
      next => {
        setReport(next)
        if (next) {
          setChoice(current => current || next.decision || '')
          setReason(current => current || next.decisionReason || '')
        }
      },
      () => {
        setError('Could not load this report. Please try again.')
        setReport(null)
      },
    )
  }, [user?.uid, reportId])

  // Clear the "NEW" badge once the report is opened.
  useEffect(() => {
    if (report && !report.viewedAt) markReportViewed(report.id).catch(() => {})
  }, [report?.id, report?.viewedAt])

  const questions = report?.questions || []
  const visibleQuestions = useMemo(() => (showAll ? questions : questions.slice(0, 5)), [questions, showAll])
  const areas = report?.areas || []
  const strengths = report?.strengths || []
  const concerns = report?.concerns || []

  const save = async event => {
    event.preventDefault()
    setSaved('')
    setError('')
    if (!choice) return setError('Choose a decision first.')
    setSaving(true)
    try {
      await saveReportDecision(report, user.uid, choice, reason)
      setSaved('Decision saved.')
    } catch {
      setError('Could not save your decision. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: `Interview report: ${report.candidateName}`, url })
      else {
        await navigator.clipboard.writeText(url)
        setShareNote('Link copied')
        setTimeout(() => setShareNote(''), 2000)
      }
    } catch {
      /* cancelled */
    }
  }

  const download = () => {
    const blob = new Blob([buildReportText(report)], { type: 'text/plain' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${(report.candidateName || 'report').replace(/\s+/g, '_')}_interview_report.txt`
    a.click()
    URL.revokeObjectURL(href)
  }

  const nav = (
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
  )

  if (report === undefined || report === null) {
    return (
      <div className="shell">
        {nav}
        <main className="page report-page">
          <div className="jobs-empty glass glass--lg">
            <span className="jobs-empty__icon">{report === null ? '?' : '···'}</span>
            <h2>{report === null ? 'Report not found' : 'Loading report'}</h2>
            <p>{report === null ? (error || 'This report does not exist or is not yours.') : 'Getting the final interview report.'}</p>
            {report === null && <button className="btn btn--primary" onClick={() => navigate('/reports')}>Back to reports</button>}
          </div>
        </main>
      </div>
    )
  }

  const decision = DECISIONS[report.decision]
  const score = typeof report.overallScore === 'number' ? report.overallScore : null
  const scoredAreas = areas.filter(a => a.covered !== false)

  return (
    <div className="shell">
      {nav}

      <main className="page report-page">
        <nav className="report-crumbs" aria-label="Breadcrumb">
          <Link to="/reports">Reports</Link> / <span>{report.candidateName}</span> / <span>Report</span>
        </nav>

        <section className="report-head">
          <div>
            <h1>
              Final interview report
              <span className={`reports-pill reports-pill--${decision ? decision.tone : 'warn'}`}>
                <i />{decision ? decision.label : 'Awaiting your decision'}
              </span>
            </h1>
            <p>
              {report.candidateName} · {report.jobTitle} · Interviewed {formatInterviewed(report.interviewedAt)} · Report generated by Gemini {formatLong(report.createdAt)}
            </p>
          </div>
          <div className="report-head__actions">
            <button className="btn btn--small" type="button" onClick={download}>↓ Download</button>
            <button className="btn btn--small" type="button" onClick={share}>↗ {shareNote || 'Share'}</button>
            {report.interviewId && (
              <Link className="btn btn--small" to={`/interviews/${report.interviewId}/transcript`}>View transcript</Link>
            )}
          </div>
        </section>

        <section className="report-kpis">
          <div className="report-kpi glass">
            <span>Overall score</span>
            <strong className="report-kpi__score">{score === null ? '—' : scoreText(score)}<small>/5</small></strong>
            <em>Average of {scoredAreas.length} scored area{scoredAreas.length === 1 ? '' : 's'}</em>
          </div>
          <div className="report-kpi report-kpi--ai glass">
            <span>AI suggestion <b>Advisory</b></span>
            <strong className="report-kpi__ai">{AI_SUGGESTIONS[report.aiSuggestion] || '—'}</strong>
            <em>{report.aiSuggestionNote || ''}</em>
          </div>
          <div className="report-kpi glass">
            <span>Plan coverage</span>
            <strong>{report.plannedCovered ?? '—'}<small> / {report.plannedTotal ?? '—'} questions</small></strong>
            <em>{report.coverageNote || ''}</em>
          </div>
          <div className="report-kpi glass">
            <span>Evidence strength</span>
            <strong>{report.evidenceStrength || '—'}</strong>
            <em>{report.evidenceNote || ''}</em>
          </div>
        </section>

        <section className="report-card glass">
          <h2>Summary</h2>
          <p>{report.summary || 'No summary was generated.'}</p>
        </section>

        <section className="report-grid">
          <div className="report-card glass">
            <h2>Scores by area</h2>
            <div className="report-areas">
              {areas.map(area => {
                const notCovered = area.covered === false
                return (
                  <div className="report-area" key={area.name}>
                    <div>
                      <span>{area.name}</span>
                      <b className={notCovered ? 'is-warn' : ''}>{notCovered ? 'Not covered' : `${scoreText(area.score)} / 5`}</b>
                    </div>
                    <span className={`report-bar report-bar--${notCovered ? 'warn' : scoreTone(area.score)}`}>
                      <i style={{ width: `${notCovered ? 4 : (area.score / 5) * 100}%` }} />
                    </span>
                  </div>
                )
              })}
              <small className="report-scale">Scale: 1 = no evidence · 3 = meets the role · 5 = strong, with examples</small>
            </div>
          </div>

          <div className="report-side">
            <div className="report-card glass report-card--good">
              <h2>Strengths</h2>
              {strengths.length === 0 && <p>No strengths recorded.</p>}
              {strengths.map(item => (
                <div className="report-point" key={item.title}>
                  <b>{item.title}</b>
                  <p>{item.detail}</p>
                  {item.quote && (
                    <blockquote>“{item.quote}” {item.questionRef && <span>{item.questionRef}</span>}</blockquote>
                  )}
                </div>
              ))}
            </div>

            <div className="report-card glass report-card--warn">
              <h2>Concerns &amp; follow-ups</h2>
              {concerns.length === 0 && <p>No concerns recorded.</p>}
              {concerns.map(item => (
                <div className="report-point" key={item.title}>
                  <b>{item.title}</b>
                  <p>{item.detail}</p>
                  {item.followUp && <p className="report-point__ask">{item.followUp}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="report-card glass">
          <div className="report-card__head">
            <h2>Question by question</h2>
            {questions.length > 5 && (
              <button className="btn btn--small" type="button" onClick={() => setShowAll(value => !value)}>
                {showAll ? 'Show fewer' : `Show all ${questions.length}`}
              </button>
            )}
          </div>
          <div className="reports-table-scroll">
            <table className="report-qtable">
              <thead>
                <tr><th>Q</th><th>Area</th><th>Score</th><th>What they said</th></tr>
              </thead>
              <tbody>
                {visibleQuestions.map(q => (
                  <tr key={q.number}>
                    <td data-label="Q"><b>Q{q.number}</b></td>
                    <td data-label="Area">{q.area}</td>
                    <td data-label="Score" className={q.covered === false ? 'is-warn' : 'is-score'}>
                      {q.covered === false ? 'Not asked' : `${scoreText(q.score)} / 5`}
                    </td>
                    <td data-label="What they said">{q.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <form className="report-card report-decision glass glass--strong" onSubmit={save}>
          <h2>Your decision</h2>
          <p>AI scores are advisory. The decision and your reasons are saved under your name.</p>
          <div className="report-decision__options" role="radiogroup" aria-label="Hiring decision">
            {Object.entries(DECISIONS).map(([key, { label }]) => (
              <label key={key} className={choice === key ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="decision"
                  value={key}
                  checked={choice === key}
                  onChange={() => { setChoice(key); setSaved('') }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <label className="report-decision__reason" htmlFor="decision-reason">Reason</label>
          <textarea
            id="decision-reason"
            rows="3"
            value={reason}
            onChange={event => { setReason(event.target.value); setSaved('') }}
            placeholder="e.g. Strong on core admin. Book a short call to cover H&S and new-starter setup before offer."
          />

          <span className="hint report-decision__msg" role="alert">{error}</span>
          {saved && <span className="report-decision__saved" role="status">{saved}</span>}

          <div>
            <button className="btn btn--primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save decision'}
            </button>
          </div>
        </form>
      </main>

      <footer className="footer">Who’s Next assists interviewers. Hiring decisions stay with you.</footer>
    </div>
  )
}