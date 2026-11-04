import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import {
  AI_SUGGESTIONS,
  DECISIONS,
  setReportArchived,
  subscribeToReports,
} from '../services/reports.js'
import './report.css'

const NEW_WINDOW_MS = 48 * 60 * 60 * 1000

function formatDate(timestamp) {
  if (!timestamp?.toDate) return '—'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(timestamp.toDate())
}

function formatTime(timestamp) {
  if (!timestamp?.toDate) return ''
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    .format(timestamp.toDate())
}

function formatShortDate(timestamp) {
  if (!timestamp?.toDate) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(timestamp.toDate())
}

export function scoreTone(score) {
  if (score >= 4) return 'good'
  if (score >= 3) return 'mid'
  return 'low'
}

function isNew(report) {
  if (report.viewedAt) return false
  const created = report.createdAt?.toMillis?.()
  return created ? Date.now() - created < NEW_WINDOW_MS : false
}

function ArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export default function ReportsPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('active')
  const [search, setSearch] = useState('')
  const [decisionFilter, setDecisionFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [busyId, setBusyId] = useState('')
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (!user?.uid) return undefined
    setLoading(true)
    return subscribeToReports(
      user.uid,
      next => {
        setReports(next)
        setLoading(false)
        setError('')
      },
      () => {
        setError('Could not load your reports. Please try again.')
        setLoading(false)
      },
    )
  }, [user?.uid])

  const active = useMemo(() => reports.filter(r => !r.archived), [reports])
  const archived = useMemo(() => reports.filter(r => r.archived), [reports])

  const stats = useMemo(() => {
    const scored = active.filter(r => typeof r.overallScore === 'number')
    const avg = scored.length
      ? scored.reduce((sum, r) => sum + r.overallScore, 0) / scored.length
      : null
    return {
      total: active.length,
      awaiting: active.filter(r => !r.decision).length,
      average: avg === null ? '—' : avg.toFixed(1),
    }
  }, [active])

  const visible = useMemo(() => {
    const source = tab === 'active' ? active : archived
    const needle = search.trim().toLowerCase()
    const filtered = source.filter(report => {
      if (needle && !(report.candidateName || '').toLowerCase().includes(needle)) return false
      if (decisionFilter === 'awaiting') return !report.decision
      if (decisionFilter !== 'all') return report.decision === decisionFilter
      return true
    })
    const created = r => r.createdAt?.toMillis?.() ?? 0
    const sorters = {
      newest: (a, b) => created(b) - created(a),
      oldest: (a, b) => created(a) - created(b),
      score_high: (a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1),
      score_low: (a, b) => (a.overallScore ?? 99) - (b.overallScore ?? 99),
      name: (a, b) => (a.candidateName || '').localeCompare(b.candidateName || ''),
    }
    return [...filtered].sort(sorters[sort] || sorters.newest)
  }, [tab, active, archived, search, decisionFilter, sort])

  const toggleArchive = async (event, report) => {
    event.stopPropagation()
    setBusyId(report.id)
    setError('')
    try {
      await setReportArchived(report.id, !report.archived)
    } catch {
      setError(`Could not ${report.archived ? 'restore' : 'archive'} this report.`)
    } finally {
      setBusyId('')
    }
  }

  const openReport = report => navigate(`/reports/${report.id}`)

  const sourceCount = tab === 'active' ? active.length : archived.length

  return (
    <div className="shell">
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

      <main className="page reports-page">
        <section className="reports-page__head">
          <div className="reports-page__intro">
            <span className="eyebrow"><i className="reports-dot reports-dot--good" /> Report library</span>
            <h1>Reports</h1>
            <p>Every final interview report in one place, newest first. Open one to see scores, evidence and the hiring decision.</p>
          </div>

          <div className="reports-stats glass glass--lg">
            <div className="reports-stat">
              <strong>{stats.total}</strong>
              <span>Total reports</span>
            </div>
            <div className="reports-stat">
              <strong>{stats.awaiting}</strong>
              <span><i className="reports-dot reports-dot--warn" /> Awaiting decision</span>
            </div>
            <div className="reports-stat">
              <strong>{stats.average}</strong>
              <span>Average score</span>
            </div>
          </div>
        </section>

        <section className="reports-toolbar">
          <h2>All reports</h2>
          <div className="reports-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'active'}
              className={tab === 'active' ? 'is-active' : ''}
              onClick={() => setTab('active')}
            >
              Active ({active.length})
            </button>
            <button
              role="tab"
              aria-selected={tab === 'archived'}
              className={tab === 'archived' ? 'is-active' : ''}
              onClick={() => setTab('archived')}
            >
              Archived ({archived.length})
            </button>
          </div>
          <span className="spacer" />
          <label className="reports-search">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by candidate name…"
              aria-label="Search reports by candidate name"
            />
          </label>
          <select
            className="reports-select"
            value={decisionFilter}
            onChange={event => setDecisionFilter(event.target.value)}
            aria-label="Filter by decision"
          >
            <option value="all">All decisions</option>
            <option value="awaiting">Awaiting decision</option>
            {Object.entries(DECISIONS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select
            className="reports-select"
            value={sort}
            onChange={event => setSort(event.target.value)}
            aria-label="Sort reports"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="score_high">Highest score</option>
            <option value="score_low">Lowest score</option>
            <option value="name">Candidate name</option>
          </select>
        </section>

        {error && <div className="jobs-message jobs-message--error" role="alert">{error}</div>}

        <section className="reports-table-wrap glass glass--lg" aria-live="polite">
          {loading ? (
            <div className="jobs-empty">
              <span className="jobs-empty__icon">···</span>
              <h2>Loading your reports</h2>
              <p>Getting the latest interview reports from your workspace.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="jobs-empty">
              <span className="jobs-empty__icon">{sourceCount === 0 ? '□' : '?'}</span>
              <h2>{sourceCount === 0 ? (tab === 'active' ? 'No reports yet' : 'Nothing archived') : 'No matching reports'}</h2>
              <p>
                {sourceCount === 0
                  ? tab === 'active'
                    ? 'Final reports appear here after you paste an interview transcript and generate the report.'
                    : 'Archived reports are kept here and can be restored any time.'
                  : 'Try a different name, decision or sort order.'}
              </p>
            </div>
          ) : (
            <div className="reports-table-scroll">
              <table className="reports-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Role</th>
                    <th>Generated</th>
                    <th>Score</th>
                    <th>AI suggestion</th>
                    <th>Decision</th>
                    <th className="reports-table__action-head">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(report => {
                    const decision = DECISIONS[report.decision]
                    const score = typeof report.overallScore === 'number' ? report.overallScore : null
                    const tone = score === null ? 'low' : scoreTone(score)
                    return (
                      <tr
                        key={report.id}
                        className="reports-row"
                        onClick={() => openReport(report)}
                      >
                        <td data-label="Candidate">
                          <div className="reports-candidate">
                            <b>{report.candidateName || 'Unnamed candidate'}</b>
                            {isNew(report) && <span className="reports-new">NEW</span>}
                          </div>
                          <small>Interviewed {formatShortDate(report.interviewedAt)}</small>
                        </td>
                        <td data-label="Role">{report.jobTitle || '—'}</td>
                        <td data-label="Generated">
                          <span>{formatDate(report.createdAt)}</span>
                          <small>{formatTime(report.createdAt)}</small>
                        </td>
                        <td data-label="Score">
                          <div className={`reports-score reports-score--${tone}`}>
                            <b>{score === null ? '—' : score.toFixed(1)} / 5</b>
                            <span><i style={{ width: `${score === null ? 0 : (score / 5) * 100}%` }} /></span>
                          </div>
                        </td>
                        <td data-label="AI suggestion">{AI_SUGGESTIONS[report.aiSuggestion] || '—'}</td>
                        <td data-label="Decision">
                          <span className={`reports-pill reports-pill--${decision ? decision.tone : 'warn'}`}>
                            <i />{decision ? decision.label : 'Awaiting decision'}
                          </span>
                        </td>
                        <td className="reports-table__actions">
                          <button
                            className="btn btn--small"
                            type="button"
                            onClick={event => { event.stopPropagation(); openReport(report) }}
                          >
                            View
                          </button>
                          <button
                            className="reports-archive-btn"
                            type="button"
                            onClick={event => toggleArchive(event, report)}
                            disabled={busyId === report.id}
                            aria-label={`${report.archived ? 'Restore' : 'Archive'} report for ${report.candidateName}`}
                            title={report.archived ? 'Restore report' : 'Archive report'}
                          >
                            <ArchiveIcon />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {!loading && (
          <p className="reports-footnote">
            Showing {visible.length} of {sourceCount} {tab} report{sourceCount === 1 ? '' : 's'} · Archived reports are hidden from this list but kept, and can be restored any time.
          </p>
        )}
      </main>

      <footer className="footer">Who’s Next assists interviewers. Hiring decisions stay with you.</footer>
    </div>
  )
}