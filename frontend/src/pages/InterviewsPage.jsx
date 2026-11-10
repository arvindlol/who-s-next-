import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { db } from '../firebase.js'

const INTERVIEW_STEPS = [
  { n: 1, title: 'Create plan', desc: 'Build questions from the role, resume and screening evidence.', ai: true },
  { n: 2, title: 'Review & approve', desc: 'Edit the questions and approve the interview plan.', ai: false },
  { n: 3, title: 'Interview takes place', desc: 'The recruiter conducts it outside Who’s Next using the approved plan.', ai: false },
  { n: 4, title: 'Add transcript', desc: 'Attach the completed interview transcript for evaluation.', ai: true },
  { n: 5, title: 'Final report', desc: 'Review evidence, scores and the recruiter decision.', ai: true },
]

const STATUS_DETAILS = {
  draft: { label: 'Plan needed', tone: 'warn', step: 1, action: 'Create plan' },
  plan_needed: { label: 'Plan needed', tone: 'warn', step: 1, action: 'Create plan' },
  plan_ready: { label: 'Plan ready', tone: 'live', step: 2, action: 'Open plan' },
  approved: { label: 'Plan approved', tone: 'live', step: 3, action: 'View plan' },
  scheduled: { label: 'Interview external', tone: 'live', step: 3, action: 'View plan' },
  invited: { label: 'Interview external', tone: 'live', step: 3, action: 'View plan' },
  in_progress: { label: 'Interview external', tone: 'warn', step: 3, action: 'View plan' },
  completed: { label: 'Awaiting transcript', tone: 'warn', step: 4, action: 'Add transcript' },
  awaiting_transcript: { label: 'Awaiting transcript', tone: 'warn', step: 4, action: 'Add transcript' },
  report_ready: { label: 'Report ready', tone: 'ok', step: 5, action: 'View report' },
  reviewed: { label: 'Reviewed', tone: 'ok', step: 5, action: 'View report' },
  selected: { label: 'Selected', tone: 'ok', step: 5, action: 'View report' },
  rejected: { label: 'Rejected', tone: 'danger', step: 5, action: 'View report' },
}

function statusKey(value) {
  return String(value || 'draft').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function statusDetails(value) {
  const key = statusKey(value)
  return STATUS_DETAILS[key] || {
    label: String(value || 'Plan needed').replace(/_/g, ' '),
    tone: 'warn',
    step: 1,
    action: 'Open interview',
  }
}

function timestampValue(timestamp) {
  return timestamp?.toMillis?.() || Number(timestamp) || 0
}

export default function InterviewsPage() {
  const { user, signOut } = useAuth()
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()
  const [interviews, setInterviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    if (!user?.uid) return undefined

    setLoading(true)
    setError('')

    const interviewsQuery = query(
      collection(db, 'interviews'),
      where('ownerId', '==', user.uid),
    )

    return onSnapshot(
      interviewsQuery,
      snapshot => {
        const nextInterviews = snapshot.docs
          .map(interviewDoc => ({ id: interviewDoc.id, ...interviewDoc.data() }))
          .sort((first, second) => timestampValue(second.updatedAt || second.createdAt) - timestampValue(first.updatedAt || first.createdAt))

        setInterviews(nextInterviews)
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
    const uniqueStatuses = new Map()
    interviews.forEach(interview => {
      const key = statusKey(interview.status)
      uniqueStatuses.set(key, statusDetails(key).label)
    })
    return [...uniqueStatuses.entries()]
  }, [interviews])

  const filteredInterviews = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return interviews.filter(interview => {
      const matchesSearch = !normalizedSearch || [
        interview.candidateName,
        interview.jobTitle,
        interview.role,
      ].some(value => String(value || '').toLowerCase().includes(normalizedSearch))
      const matchesStatus = statusFilter === 'all' || statusKey(interview.status) === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [interviews, search, statusFilter])

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

      <main className="page interviews-page">
        <section className="interviews-page__head">
          <span className="eyebrow">Interview workspace</span>
          <h1>Interviews</h1>
          <p>Prepare and track candidate interviews after screening. Every interview stays connected to its candidate, role and screening evidence.</p>
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
                <input
                  type="search"
                  placeholder="Search candidate or job…"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
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
            ) : filteredInterviews.length === 0 ? (
              <div className="interviews-empty"><b>No matching interviews</b><span>Try changing the search or status filter.</span></div>
            ) : (
              <div className="interviews-table-scroll">
                <table className="interviews-table">
                  <thead>
                    <tr><th>Candidate</th><th>Job</th><th>Progress</th><th>Status</th><th><span className="visually-hidden">Action</span></th></tr>
                  </thead>
                  <tbody>
                    {filteredInterviews.map(interview => {
                      const details = statusDetails(interview.status)
                      return (
                        <tr key={interview.id}>
                          <td data-label="Candidate"><b>{interview.candidateName || 'Unnamed candidate'}</b><small>{interview.role || 'Candidate interview'}</small></td>
                          <td data-label="Job">{interview.jobTitle || 'Untitled job'}</td>
                          <td data-label="Progress">
                            <div className="interview-progress" aria-label={`Step ${details.step} of 5: ${INTERVIEW_STEPS[details.step - 1].title}`}>
                              <span className="interview-progress__track" aria-hidden="true">
                                {INTERVIEW_STEPS.map(step => <i className={step.n <= details.step ? 'is-complete' : ''} key={step.n} />)}
                              </span>
                              <small>Step {details.step} of 5 · {INTERVIEW_STEPS[details.step - 1].title}</small>
                            </div>
                          </td>
                          <td data-label="Status"><span className={`pill pill--${details.tone}`}><span className="dot" />{details.label}</span></td>
                          <td className="interviews-table__action">
                            {details.step <= 2 || interview.plan ? (
                              <Link className="btn btn--small" to={interview.plan ? `/interviews/${interview.id}/review` : `/interviews/${interview.id}/plan`}>{details.action}</Link>
                            ) : (
                              <button className="btn btn--small" type="button" disabled title="This part of the workflow comes in a later phase.">{details.action}</button>
                            )}
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
      </main>

      <footer className="footer">Who’s Next supports structured interviews. Hiring decisions stay with you.</footer>
    </div>
  )
}
