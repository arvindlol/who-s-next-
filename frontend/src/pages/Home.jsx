import { NavLink } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'

const PIPELINE = [
  { n: 1, title: 'Job description', desc: 'Extract the skills and responsibilities that matter.', ai: true },
  { n: 2, title: 'Resume fit', desc: 'Score each resume against the role and flag gaps.', ai: true },
  { n: 3, title: 'Interview plan', desc: 'Questions tailored to this candidate and this role.', ai: true },
  { n: 4, title: 'Interview', desc: 'You run it. Sift stays out of the room.', ai: false },
  { n: 5, title: 'Transcript', desc: 'Upload the transcript when you are done.', ai: true },
  { n: 6, title: 'Final report', desc: 'Structured evaluation to support your decision.', ai: true },
]

const JOBS = [
  { title: 'Senior Backend Engineer', team: 'Platform · Python, FastAPI, Postgres', candidates: 4, status: 'live' },
  { title: 'Frontend Developer', team: 'Product · React, TypeScript', candidates: 2, status: 'warn' },
  { title: 'Data Engineer', team: 'Analytics · Spark, Airflow', candidates: 0, status: 'ok' },
]

export default function Home() {
  const { user, signOut } = useAuth()
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  return (
    <div className="shell">
      <header className="topbar glass glass--strong">
        <Brand />
        <nav>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/candidates">Candidates</NavLink>
          <NavLink to="/reports">Reports</NavLink>
        </nav>
        <span className="spacer" />
        <button className="btn btn--ghost" onClick={signOut}>Log out</button>
        <span className="avatar" title={user?.email}>{initials}</span>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero__text">
            <span className="pill pill--live"><span className="dot" />Workspace ready</span>
            <h1 style={{ marginTop: 14 }}>Good to see you, {user?.name}.</h1>
            <p>Start with a job description. Sift will structure it, then you can add resumes one at a time and get a fit report for each.</p>
            <div className="hero__actions">
              <button className="btn btn--primary">Add job description</button>
              <button className="btn">Upload a resume</button>
            </div>
          </div>
          <aside className="hero__stats glass glass--lg" aria-label="Summary">
            <div className="stat"><b>3</b><span>Open roles</span></div>
            <div className="stat"><b>6</b><span>Candidates screened</span></div>
            <div className="stat"><b>2</b><span>Plans ready</span></div>
          </aside>
        </section>

        <section className="section">
          <div className="section__head"><h2>How a candidate moves through Sift</h2></div>
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
            <div className="section__head"><h2>Your jobs</h2><a href="#">See all</a></div>
            <div className="jobs glass glass--lg">
              {JOBS.map(j => (
                <div key={j.title} className="job">
                  <div><h3>{j.title}</h3><p>{j.team}</p></div>
                  <span className="count">{j.candidates} candidate{j.candidates === 1 ? '' : 's'}</span>
                  <span className={`pill pill--${j.status}`}>
                    <span className="dot" />
                    {j.status === 'live' ? 'Interviews this week' : j.status === 'warn' ? 'Plans pending' : 'Awaiting resumes'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="section__head"><h2>Quick upload</h2></div>
            <div className="upload glass glass--lg">
              <div className="dropzone" role="button" tabIndex={0}>
                <b>Drop a resume or transcript here</b>
                PDF, DOCX or TXT
              </div>
              <small>Files are stored privately in your workspace and never shared with other users.</small>
              <button className="btn btn--block">Choose a file</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">Sift assists interviewers. Hiring decisions stay with you.</footer>
    </div>
  )
}
