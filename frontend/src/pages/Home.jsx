import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { stageTone } from '../constants/statuses.js'
import { subscribeToCandidates } from '../services/candidates.js'
import { subscribeToDashboardStats } from '../services/dashboard.js'
import { subscribeToHomeJobs } from '../services/homeJobs.js'
import { formatDate, getInitials } from '../utils/format.js'

const PIPELINE = [
  { n: 1, title: 'Job description', desc: 'Upload the role you are hiring for as a PDF.', ai: false },
  { n: 2, title: 'Resume fit', desc: 'Score each resume against the role and flag gaps.', ai: true },
  { n: 3, title: 'Interview plan', desc: 'Questions tailored to this candidate and this role.', ai: true },
  { n: 4, title: 'Interview', desc: 'You run it. Who’s Next stays out of the room.', ai: false },
  { n: 5, title: 'Transcript', desc: 'Add the transcript when you are done.', ai: false },
  { n: 6, title: 'Final report', desc: 'Structured evaluation to support your decision.', ai: true },
]

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState({ jobDescriptions: 0, pendingInterviews: 0, screeningReports: 0 })
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)
  const [homeJobs, setHomeJobs] = useState([])
  const [homeJobsLoading, setHomeJobsLoading] = useState(true)
  const [homeJobsError, setHomeJobsError] = useState(false)
  const [recentCandidates, setRecentCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(true)
  const [candidatesError, setCandidatesError] = useState(false)

  useEffect(() => {
    if (!user?.uid) return undefined
    setStatsLoading(true)
    setStatsError(false)
    return subscribeToDashboardStats(user.uid, setStats, () => setStatsLoading(false), error => {
      console.error('Could not load dashboard statistics:', error)
      setStatsError(true)
    })
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    setCandidatesLoading(true)
    setCandidatesError(false)
    return subscribeToCandidates(
      user.uid,
      candidates => {
        setRecentCandidates(candidates.slice(0, 3))
        setCandidatesLoading(false)
      },
      error => {
        console.error('Could not load recent candidates:', error)
        setCandidatesError(true)
        setCandidatesLoading(false)
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    setHomeJobsLoading(true)
    setHomeJobsError(false)
    return subscribeToHomeJobs(user.uid, setHomeJobs, () => setHomeJobsLoading(false), error => {
      console.error('Could not load recent jobs:', error)
      setHomeJobsError(true)
    })
  }, [user?.uid])

  return (
    <AppLayout>
      <section className="hero">
        <div className="hero__text">
          <span className="pill pill--live"><span className="dot" />Workspace ready</span>
          <h1 style={{ marginTop: 14 }}>Good to see you, {user?.name}.</h1>
          <p>Start with a job description, add candidates with their PDF resumes, then screen them and prepare structured interviews.</p>
          <div className="hero__actions">
            <button className="btn btn--primary" onClick={() => navigate('/jobs?new=true')}>Add job description</button>
            <button className="btn" onClick={() => navigate('/candidates?new=true')}>Add candidate</button>
          </div>
        </div>
        <aside className="hero__stats glass glass--lg" aria-label="Workspace summary" title={statsError ? 'Some workspace statistics could not be loaded.' : undefined}>
          <div className="stat"><b>{statsLoading ? '—' : stats.jobDescriptions}</b><span>Open jobs</span></div>
          <div className="stat"><b>{statsLoading ? '—' : stats.pendingInterviews}</b><span>Interviews in progress</span></div>
          <div className="stat"><b>{statsLoading ? '—' : stats.screeningReports}</b><span>Screening reports</span></div>
        </aside>
      </section>

      <section className="section">
        <div className="section__head"><h2>How a candidate moves through Who’s Next</h2></div>
        <div className="pipeline glass glass--lg">
          {PIPELINE.map(stage => (
            <div key={stage.n} className={`stage ${stage.ai ? 'stage--ai' : 'stage--human'}`}>
              <span className="stage__n">{stage.n}</span>
              <h3>{stage.title}</h3>
              <p>{stage.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section grid-2">
        <div>
          <div className="section__head"><h2>Your jobs</h2><Link to="/jobs">See all</Link></div>
          <div className="jobs glass glass--lg">
            {homeJobsLoading ? (
              <div className="empty"><b>Loading your jobs…</b></div>
            ) : homeJobsError ? (
              <div className="empty"><b>Could not load your jobs</b><span>Please refresh and try again.</span></div>
            ) : homeJobs.length === 0 ? (
              <div className="empty"><b>No jobs yet</b><span>Upload a job description to get started.</span></div>
            ) : homeJobs.map(job => (
              <div key={job.id} className="job">
                <div><h3>{job.title}</h3><p>Uploaded {formatDate(job.createdAt, 'just now')}</p></div>
                <span className="count">{job.candidateCount} candidate{job.candidateCount === 1 ? '' : 's'} screened</span>
                <span className={`pill pill--${job.statusTone}`}><span className="dot" />{job.workflowStatus}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="section__head"><h2>Your candidates</h2><Link to="/candidates">View all</Link></div>
          <div className="home-candidates glass glass--lg">
            {candidatesLoading ? (
              <div className="empty"><b>Loading your candidates…</b></div>
            ) : candidatesError ? (
              <div className="empty"><b>Could not load your candidates</b><span>Please refresh and try again.</span></div>
            ) : recentCandidates.length === 0 ? (
              <div className="empty"><b>No candidates yet</b><span>Add a candidate and their resume to begin screening.</span></div>
            ) : recentCandidates.map(candidate => (
              <Link className="home-candidate" to={`/candidates?candidateId=${encodeURIComponent(candidate.id)}`} key={candidate.id}>
                <span className="home-candidate__avatar" aria-hidden="true">{getInitials(candidate.name || 'Candidate')}</span>
                <span className="home-candidate__details">
                  <b>{candidate.name || 'Unnamed candidate'}</b>
                  <small>{candidate.role || 'Role not specified'}</small>
                </span>
                <span className={`pill pill--${stageTone(candidate.status)}`}><span className="dot" />{candidate.status}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </AppLayout>
  )
}
