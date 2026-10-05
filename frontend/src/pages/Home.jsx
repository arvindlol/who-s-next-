import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { subscribeToDashboardStats } from '../services/dashboard.js'
import { subscribeToHomeJobs } from '../services/homeJobs.js'
import { getScreenings } from '../data/screeningDemo.js'

const PIPELINE = [
  { n: 1, title: 'Job description', desc: 'Extract the skills and responsibilities that matter.', ai: true },
  { n: 2, title: 'Resume fit', desc: 'Score each resume against the role and flag gaps.', ai: true },
  { n: 3, title: 'Interview plan', desc: 'Questions tailored to this candidate and this role.', ai: true },
  { n: 4, title: 'Interview', desc: 'You run it. Who’s Next stays out of the room.', ai: false },
  { n: 5, title: 'Transcript', desc: 'Upload the transcript when you are done.', ai: true },
  { n: 6, title: 'Final report', desc: 'Structured evaluation to support your decision.', ai: true },
]

function formatJobDate(timestamp) {
  if (!timestamp?.toDate) return 'Uploaded just now'
  const date = new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(timestamp.toDate())
  return `Uploaded ${date}`
}

export default function Home() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()
  const [stats, setStats] = useState({
    jobDescriptions: 0,
    pendingInterviews: 0,
    screeningReports: 0,
  })
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)
  const [homeJobs, setHomeJobs] = useState([])
  const [homeJobsLoading, setHomeJobsLoading] = useState(true)
  const [homeJobsError, setHomeJobsError] = useState(false)
  const recentCandidates = useMemo(() => {
    const seenCandidateIds = new Set()
    const candidates = []

    getScreenings().forEach(screening => {
      screening.results.forEach(candidate => {
        if (seenCandidateIds.has(candidate.id)) return
        seenCandidateIds.add(candidate.id)
        candidates.push({
          ...candidate,
          jobTitle: screening.jobTitle,
          workflowStatus: screening.status === 'completed' ? 'Screening ready' : 'Resume uploaded',
        })
      })
    })

    return candidates.slice(0, 3)
  }, [])

  useEffect(() => {
    if (!user?.uid) return undefined
    setStatsLoading(true)
    setStatsError(false)
    return subscribeToDashboardStats(
      user.uid,
      setStats,
      () => setStatsLoading(false),
      error => {
        console.error('Could not load dashboard statistics:', error)
        setStatsError(true)
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    setHomeJobsLoading(true)
    setHomeJobsError(false)
    return subscribeToHomeJobs(
      user.uid,
      setHomeJobs,
      () => setHomeJobsLoading(false),
      error => {
        console.error('Could not load recent jobs:', error)
        setHomeJobsError(true)
      },
    )
  }, [user?.uid])

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

      <main className="page">
        <section className="hero">
          <div className="hero__text">
            <span className="pill pill--live"><span className="dot" />Workspace ready</span>
            <h1 style={{ marginTop: 14 }}>Good to see you, {user?.name}.</h1>
            <p>Start with a job description. Who’s Next will structure it, then you can add resumes one at a time and get a fit report for each.</p>
            <div className="hero__actions">
              <button className="btn btn--primary" onClick={() => navigate('/jobs?new=true')}>Add job description</button>
              <button className="btn" onClick={() => navigate('/candidates?new=true')}>Add Candidate</button>
            </div>
          </div>
          <aside
            className="hero__stats glass glass--lg"
            aria-label="Workspace summary"
            title={statsError ? 'Some workspace statistics could not be loaded.' : undefined}
          >
            <div className="stat"><b>{statsLoading ? '—' : stats.jobDescriptions}</b><span>Job descriptions</span></div>
            <div className="stat"><b>{statsLoading ? '—' : stats.pendingInterviews}</b><span>Interviews pending</span></div>
            <div className="stat"><b>{statsLoading ? '—' : stats.screeningReports}</b><span>Screening reports</span></div>
          </aside>
        </section>

        <section className="section">
          <div className="section__head"><h2>How a candidate moves through Who’s Next</h2></div>
          <div className="pipeline glass glass--lg">
            {PIPELINE.map(s => (
              <div key={s.n} className={`stage ${s.ai ? 'stage--ai' : 'stage--human'}`}>
                <span className="stage__n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
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
                <div className="empty">
                  <b>No jobs yet</b>
                  <span>Upload a job description to get started.</span>
                </div>
              ) : homeJobs.map(job => (
                <div key={job.id} className="job">
                  <div><h3>{job.title}</h3><p>{formatJobDate(job.createdAt)}</p></div>
                  <span className="count">{job.candidateCount} candidate{job.candidateCount === 1 ? '' : 's'}</span>
                  <span className={`pill pill--${job.statusTone}`}>
                    <span className="dot" />
                    {job.workflowStatus}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="section__head"><h2>Your Candidates</h2><Link to="/candidates">View all</Link></div>
            <div className="home-candidates glass glass--lg">
              {recentCandidates.length === 0 ? (
                <div className="empty">
                  <b>No candidates yet</b>
                  <span>Add a candidate and their resume to begin screening.</span>
                </div>
              ) : recentCandidates.map(candidate => (
                <Link className="home-candidate" to={`/candidates?candidateId=${encodeURIComponent(candidate.id)}`} key={candidate.id}>
                  <span className="home-candidate__avatar" aria-hidden="true">
                    {candidate.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <span className="home-candidate__details">
                    <b>{candidate.name}</b>
                    <small>{candidate.jobTitle}</small>
                  </span>
                  <span className="pill pill--live"><span className="dot" />{candidate.workflowStatus}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">Who’s Next assists interviewers. Hiring decisions stay with you.</footer>
    </div>
  )
}
