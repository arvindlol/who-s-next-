import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { INTERVIEW_STEPS, interviewStatusDetails, interviewStatusKey } from '../constants/statuses.js'
import { subscribeToInterviews } from '../services/interviews.js'

export default function InterviewsPage() {
  const { user } = useAuth()
  const [interviews, setInterviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    if (!user?.uid) return undefined
    setLoading(true)
    return subscribeToInterviews(
      user.uid,
      next => {
        setInterviews(next)
        setError('')
        setLoading(false)
      },
      loadError => {
        console.error('Could not load interviews:', loadError)
        setError('Could not load interviews. Please refresh and try again.')
        setLoading(false)
      },
    )
  }, [user?.uid])

  const availableStatuses = useMemo(() => {
    const statuses = new Map()
    interviews.forEach(interview => statuses.set(interviewStatusKey(interview.status), interviewStatusDetails(interview).label))
    return [...statuses.entries()]
  }, [interviews])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return interviews.filter(interview => {
      const matchesSearch = !term || [interview.candidateName, interview.jobTitle, interview.role]
        .some(value => String(value || '').toLowerCase().includes(term))
      const matchesStatus = statusFilter === 'all' || interviewStatusKey(interview.status) === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [interviews, search, statusFilter])

  return (
    <AppLayout mainClassName="page interviews-page" footer="Who’s Next supports structured interviews. Hiring decisions stay with you.">
      <section className="interviews-page__head">
        <span className="eyebrow">Interview workspace</span>
        <h1>Interviews</h1>
        <p>Prepare, run and evaluate structured interviews. Every interview stays connected to its candidate, role and screening evidence.</p>
      </section>

      <section className="section">
        <div className="section__head"><h2>Interview workflow</h2></div>
        <div className="pipeline interview-pipeline glass glass--lg">
          {INTERVIEW_STEPS.map(step => (
            <div key={step.n} className={`stage ${step.ai ? 'stage--ai' : 'stage--human'}`}>
              <span className="stage__n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section interviews-list-section">
        <div className="interviews-list__head">
          <div>
            <h2>All interviews</h2>
            <span>{loading ? 'Loading…' : `${interviews.length} total`}</span>
          </div>
          <div className="interviews-toolbar">
            <label>
              <span className="visually-hidden">Search interviews</span>
              <input type="search" placeholder="Search candidate or job…" value={search} onChange={event => setSearch(event.target.value)} />
            </label>
            <label>
              <span className="visually-hidden">Filter interviews by status</span>
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                {availableStatuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="interviews-table-wrap glass glass--lg" aria-live="polite">
          {loading ? (
            <div className="interviews-empty"><b>Loading interviews…</b><span>Getting the latest interview activity.</span></div>
          ) : error ? (
            <div className="interviews-empty interviews-empty--error"><b>Interviews unavailable</b><span>{error}</span></div>
          ) : interviews.length === 0 ? (
            <div className="interviews-empty">
              <b>No interviews yet</b>
              <span>Advance a candidate from their screening results to begin interview preparation.</span>
              <Link className="btn btn--primary" to="/screening">Review screening results</Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="interviews-empty"><b>No matching interviews</b><span>Try changing the search or status filter.</span></div>
          ) : (
            <div className="interviews-table-scroll">
              <table className="interviews-table">
                <thead>
                  <tr><th>Candidate</th><th>Job</th><th>Progress</th><th>Status</th><th><span className="visually-hidden">Action</span></th></tr>
                </thead>
                <tbody>
                  {filtered.map(interview => {
                    const details = interviewStatusDetails(interview)
                    const step = INTERVIEW_STEPS[details.step - 1]
                    return (
                      <tr key={interview.id}>
                        <td data-label="Candidate">
                          <b>{interview.candidateName || 'Unnamed candidate'}</b>
                          <small>{interview.role || 'Candidate interview'}{interview.round > 1 ? ` · Round ${interview.round}` : ''}</small>
                        </td>
                        <td data-label="Job">{interview.jobTitle || 'Untitled job'}</td>
                        <td data-label="Progress">
                          <div className="interview-progress" aria-label={`Step ${details.step} of 5: ${step.title}`}>
                            <span className="interview-progress__track" aria-hidden="true">
                              {INTERVIEW_STEPS.map(item => <i className={item.n <= details.step ? 'is-complete' : ''} key={item.n} />)}
                            </span>
                            <small>Step {details.step} of 5 · {step.title}</small>
                          </div>
                        </td>
                        <td data-label="Status"><span className={`pill pill--${details.tone}`}><span className="dot" />{details.label}</span></td>
                        <td className="interviews-table__action">
                          <Link className="btn btn--small" to={details.to}>{details.action}</Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </AppLayout>
  )
}
