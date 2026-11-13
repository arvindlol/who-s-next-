import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { DECISIONS } from '../constants/statuses.js'
import { subscribeToReports } from '../services/interviews.js'
import { formatDate } from '../utils/format.js'

const DECISION_TONES = { offer: 'ok', another: 'warn', reject: 'danger' }

export default function ReportsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [decisionFilter, setDecisionFilter] = useState('all')
  const jobId = searchParams.get('jobId') || ''

  useEffect(() => {
    if (!user?.uid) return undefined
    setLoading(true)
    return subscribeToReports(
      user.uid,
      next => {
        setReports(next)
        setError('')
        setLoading(false)
      },
      loadError => {
        console.error('Could not load reports:', loadError)
        setError('Could not load reports. Please refresh and try again.')
        setLoading(false)
      },
    )
  }, [user?.uid])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return reports.filter(report => {
      if (jobId && report.jobId !== jobId) return false
      if (decisionFilter === 'pending' && report.decision) return false
      if (!['all', 'pending'].includes(decisionFilter) && report.decision?.value !== decisionFilter) return false
      return !term || [report.candidateName, report.jobTitle, report.role].some(value => String(value || '').toLowerCase().includes(term))
    })
  }, [reports, search, decisionFilter, jobId])

  const jobTitle = jobId ? reports.find(report => report.jobId === jobId)?.jobTitle : ''

  return (
    <AppLayout mainClassName="page interviews-page">
      <section className="interviews-page__head">
        <span className="eyebrow">Final reports</span>
        <h1>Reports</h1>
        <p>Evidence-based interview reports and the decisions you recorded.</p>
      </section>

      {jobId && (
        <div className="workflow-notice" role="note">
          <b>Showing reports for {jobTitle || 'one job'}</b>
          <button type="button" className="btn btn--small" onClick={() => setSearchParams({}, { replace: true })}>Show all jobs</button>
        </div>
      )}

      <section className="section interviews-list-section">
        <div className="interviews-list__head">
          <div><h2>All reports</h2><span>{loading ? 'Loading…' : `${filtered.length} shown`}</span></div>
          <div className="interviews-toolbar">
            <label>
              <span className="visually-hidden">Search reports</span>
              <input type="search" placeholder="Search candidate or job…" value={search} onChange={event => setSearch(event.target.value)} />
            </label>
            <label>
              <span className="visually-hidden">Filter by decision</span>
              <select value={decisionFilter} onChange={event => setDecisionFilter(event.target.value)}>
                <option value="all">All decisions</option>
                <option value="pending">Awaiting decision</option>
                {DECISIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="interviews-table-wrap glass glass--lg" aria-live="polite">
          {loading ? (
            <div className="interviews-empty"><b>Loading reports…</b></div>
          ) : error ? (
            <div className="interviews-empty interviews-empty--error"><b>Reports unavailable</b><span>{error}</span></div>
          ) : filtered.length === 0 ? (
            <div className="interviews-empty">
              <b>{reports.length ? 'No matching reports' : 'No reports yet'}</b>
              <span>{reports.length ? 'Try changing the search or filter.' : 'Reports appear here after you add an interview transcript and generate the final report.'}</span>
              {!reports.length && <Link className="btn btn--primary" to="/interviews">Go to interviews</Link>}
            </div>
          ) : (
            <div className="interviews-table-scroll">
              <table className="interviews-table">
                <thead>
                  <tr><th>Candidate</th><th>Job</th><th>Score</th><th>AI suggestion</th><th>Decision</th><th><span className="visually-hidden">Action</span></th></tr>
                </thead>
                <tbody>
                  {filtered.map(report => (
                    <tr key={report.id}>
                      <td data-label="Candidate"><b>{report.candidateName}</b><small>Generated {formatDate(report.generatedAt)}</small></td>
                      <td data-label="Job">{report.jobTitle}{report.round > 1 ? ` · Round ${report.round}` : ''}</td>
                      <td data-label="Score">{report.overallScore == null ? '–' : `${report.overallScore.toFixed(1)} / 5`}</td>
                      <td data-label="AI suggestion">{report.suggestion?.label}</td>
                      <td data-label="Decision">
                        {report.decision
                          ? <span className={`pill pill--${DECISION_TONES[report.decision.value] || 'ok'}`}><span className="dot" />{report.decision.label}</span>
                          : <span className="pill pill--warn"><span className="dot" />Awaiting decision</span>}
                      </td>
                      <td className="interviews-table__action"><Link className="btn btn--small" to={`/interviews/${report.interviewId || report.id}/report`}>Open report</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </AppLayout>
  )
}
