import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { subscribeToJobs } from '../services/jobs.js'
import {
  createDemoScreening,
  DEMO_CANDIDATES,
  getScreenings,
} from '../data/screeningDemo.js'

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function ScreeningResultsModal({ screening, onClose }) {
  useEffect(() => {
    const closeOnEscape = event => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="modal__card screening-results glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="screening-results-title">
        <div className="modal__head">
          <div>
            <span className="eyebrow">Screening results</span>
            <h3 id="screening-results-title">{screening.jobTitle}</h3>
            <p>{screening.results.length} candidates compared · {formatDate(screening.createdAt)}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="screening-results__table-wrap">
          <table className="screening-results__table">
            <thead>
              <tr><th>Candidate</th><th>Resume</th><th>Score</th><th>Recommendation</th><th><span className="visually-hidden">Action</span></th></tr>
            </thead>
            <tbody>
              {screening.results.map(result => (
                <tr key={result.id}>
                  <td><b>{result.name}</b></td>
                  <td>{result.resumeName}</td>
                  <td><span className={`score score--${result.score >= 80 ? 'high' : result.score >= 70 ? 'medium' : 'low'}`}>{result.score}%</span></td>
                  <td>{result.recommendation}</td>
                  <td>
                    <Link
                      className="btn btn--small"
                      to={`/screening/${screening.id}/report/${result.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View report
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal__actions"><button className="btn" onClick={onClose}>Close</button></div>
      </section>
    </div>
  )
}

function NewScreeningModal({ jobs, onCreate, onClose }) {
  const [step, setStep] = useState(1)
  const [jobId, setJobId] = useState('')
  const [candidateIds, setCandidateIds] = useState([])
  const [error, setError] = useState('')

  const toggleCandidate = candidateId => {
    setCandidateIds(current => current.includes(candidateId)
      ? current.filter(id => id !== candidateId)
      : [...current, candidateId])
    setError('')
  }

  const submit = event => {
    event.preventDefault()
    if (!jobId) return setError('Select a job description.')
    if (candidateIds.length === 0) return setError('Select at least one candidate resume.')
    const job = jobs.find(item => item.id === jobId)
    const candidates = DEMO_CANDIDATES.filter(candidate => candidateIds.includes(candidate.id))
    onCreate(job, candidates)
  }

  const continueToResumes = () => {
    if (!jobId) return setError('Select a job description to continue.')
    setError('')
    setStep(2)
  }

  const selectedJob = jobs.find(job => job.id === jobId)

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="modal__card new-screening glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="new-screening-title">
        <div className="modal__head">
          <div>
            <h3 id="new-screening-title">New comparison</h3>
            <p>{step === 1 ? 'First, choose the job description.' : `Now choose resumes for ${selectedJob?.title || 'this job'}.`}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="new-screening__steps" aria-label={`Step ${step} of 2`}>
          <span className="new-screening__step new-screening__step--active"><b>1</b> Job description</span>
          <span className={`new-screening__step${step === 2 ? ' new-screening__step--active' : ''}`}><b>2</b> Candidate resumes</span>
        </div>

        <form onSubmit={submit} className="new-screening__form">
          {step === 1 ? (
            <fieldset>
              <div className="new-screening__legend"><span>Select a job description</span><Link to="/jobs?new=true">Upload new JD</Link></div>
              {jobs.length === 0 ? (
                <div className="selection-empty">No uploaded job descriptions are ready.</div>
              ) : jobs.map(job => (
                <label className={`selection-row${jobId === job.id ? ' selection-row--selected' : ''}`} key={job.id}>
                  <input
                    type="radio"
                    name="job"
                    value={job.id}
                    checked={jobId === job.id}
                    onChange={() => {
                      setJobId(job.id)
                      setError('')
                    }}
                  />
                  <span><b>{job.title}</b><small>{job.originalFilename}</small></span>
                </label>
              ))}
            </fieldset>
          ) : (
            <fieldset>
              <div className="new-screening__legend"><span>Select candidate resumes</span><Link to="/candidates?new=true">Upload new resume</Link></div>
              <div className="candidate-selection">
                {DEMO_CANDIDATES.map(candidate => (
                  <label className={`selection-row${candidateIds.includes(candidate.id) ? ' selection-row--selected' : ''}`} key={candidate.id}>
                    <input type="checkbox" checked={candidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} />
                    <span><b>{candidate.name}</b><small>{candidate.resumeName}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <span className="hint new-screening__error" role="alert">{error}</span>
          <div className="modal__actions new-screening__actions">
            {step === 2 && (
              <button className="btn new-screening__back" type="button" onClick={() => { setStep(1); setError('') }}>← Back</button>
            )}
            {step === 1 ? (
              <button className="btn btn--primary" type="button" onClick={continueToResumes} disabled={!jobId}>Continue</button>
            ) : (
              <button className="btn btn--primary" type="submit" disabled={candidateIds.length === 0}>Start comparison ({candidateIds.length})</button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}

export default function ScreeningPage() {
  const { user, signOut } = useAuth()
  const [screenings, setScreenings] = useState(() => getScreenings())
  const [jobs, setJobs] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [selectedScreening, setSelectedScreening] = useState(null)
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToJobs(user.uid, nextJobs => setJobs(nextJobs.filter(job => job.status === 'ready')), console.error)
  }, [user?.uid])

  const createScreening = (job, candidates) => {
    const screening = createDemoScreening(job, candidates)
    setScreenings(current => [screening, ...current])
    setShowNew(false)
    setSelectedScreening(screening)
  }

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

      <main className="page screening-page">
        <section className="screening-page__head">
          <div><span className="eyebrow">Candidate evaluation</span><h1>Candidate Screening</h1><p>Compare resumes with job requirements and review candidate-specific reports.</p></div>
          <button className="btn btn--primary" onClick={() => setShowNew(true)}>＋ New comparison</button>
        </section>

        <section className="screening-history glass glass--lg">
          <div className="screening-history__head"><h2>Recent comparisons</h2><span>{screenings.length} total</span></div>
          <div className="screening-history__scroll">
            <table className="screening-history__table">
              <thead><tr><th>Date</th><th>Job</th><th>Candidates</th><th>Status</th><th><span className="visually-hidden">Action</span></th></tr></thead>
              <tbody>
                {screenings.map(screening => (
                  <tr key={screening.id}>
                    <td>{formatDate(screening.createdAt)}</td>
                    <td><b>{screening.jobTitle}</b>{screening.demo && <small>Demo results</small>}</td>
                    <td>{screening.results.length}</td>
                    <td><span className="job-status job-status--ready"><span />Completed</span></td>
                    <td><button className="btn btn--small" onClick={() => setSelectedScreening(screening)}>View screening</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="footer">Screening results support interviewer judgment and do not make hiring decisions.</footer>
      {showNew && <NewScreeningModal jobs={jobs} onCreate={createScreening} onClose={() => setShowNew(false)} />}
      {selectedScreening && <ScreeningResultsModal screening={selectedScreening} onClose={() => setSelectedScreening(null)} />}
    </div>
  )
}
