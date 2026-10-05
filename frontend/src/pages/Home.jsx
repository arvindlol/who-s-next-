import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { subscribeToDashboardStats } from '../services/dashboard.js'
import { subscribeToHomeJobs } from '../services/homeJobs.js'

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
  const [showUploadType, setShowUploadType] = useState(false)
  const [pendingUploadFile, setPendingUploadFile] = useState(null)
  const [draggingUpload, setDraggingUpload] = useState(false)

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

  const openUploadType = (file = null) => {
    setPendingUploadFile(file)
    setShowUploadType(true)
  }

  const chooseUploadType = type => {
    const destination = type === 'job' ? '/jobs?new=true' : '/candidates?new=true'
    navigate(destination, {
      state: pendingUploadFile ? { pendingUploadFile } : undefined,
    })
    setShowUploadType(false)
    setPendingUploadFile(null)
  }

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
              <button className="btn" onClick={() => navigate('/candidates?new=true')}>Upload a resume</button>
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
            <div className="section__head"><h2>Quick upload</h2></div>
            <div className="upload glass glass--lg">
              <div
                className={`dropzone${draggingUpload ? ' dropzone--dragging' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => openUploadType()}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openUploadType()
                  }
                }}
                onDragEnter={event => {
                  event.preventDefault()
                  setDraggingUpload(true)
                }}
                onDragOver={event => event.preventDefault()}
                onDragLeave={event => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setDraggingUpload(false)
                }}
                onDrop={event => {
                  event.preventDefault()
                  setDraggingUpload(false)
                  const file = event.dataTransfer.files?.[0]
                  if (file) openUploadType(file)
                }}
              >
                <b>Drop a job description or resume here</b>
                PDF, DOCX or TXT
              </div>
              <small>Files are stored privately in your workspace and never shared with other users.</small>
              <button className="btn btn--block" onClick={() => openUploadType()}>Choose upload type</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">Who’s Next assists interviewers. Hiring decisions stay with you.</footer>

      {showUploadType && (
        <div
          className="modal"
          onMouseDown={event => event.target === event.currentTarget && setShowUploadType(false)}
        >
          <section className="modal__card upload-type-modal glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="upload-type-title">
            <div className="modal__head">
              <div>
                <h3 id="upload-type-title">What are you uploading?</h3>
                <p>We’ll take you to the right workspace.</p>
              </div>
              <button className="icon-btn" type="button" onClick={() => setShowUploadType(false)} aria-label="Close">×</button>
            </div>

            {pendingUploadFile && (
              <div className="upload-type-file">
                <span className="file-picker__icon">↑</span>
                <span><b>{pendingUploadFile.name}</b><small>{(pendingUploadFile.size / 1024 / 1024).toFixed(2)} MB</small></span>
              </div>
            )}

            <div className="upload-type-options">
              <button className="upload-type-option" type="button" onClick={() => chooseUploadType('job')}>
                <span>JD</span>
                <div><b>Job description</b><small>Create a new job and add its requirements.</small></div>
              </button>
              <button className="upload-type-option" type="button" onClick={() => chooseUploadType('resume')}>
                <span>CV</span>
                <div><b>Candidate resume</b><small>Add a candidate and their resume.</small></div>
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
