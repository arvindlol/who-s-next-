import "./Homepage.css";

export default function Homepage() {
  const jobs = [
    {
      title: "Senior Backend Engineer",
      department: "Engineering",
      candidates: 12,
      status: "Hiring",
    },
    {
      title: "Frontend Developer",
      department: "Product",
      candidates: 8,
      status: "Screening",
    },
    {
      title: "Data Engineer",
      department: "Analytics",
      candidates: 5,
      status: "Open",
    },
  ];

  const steps = [
    "Create Job",
    "Upload Resumes",
    "Screen Candidates",
    "Plan Interview",
    "Conduct Interview",
    "Generate Report",
  ];

  return (
    <div className="dashboard">

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          WHO'S NEXT
        </div>

        <nav>
          <a className="active">🏠 Dashboard</a>
          <a>💼 Jobs</a>
          <a>👥 Candidates</a>
          <a>📊 Reports</a>
        </nav>

        <div className="sidebar-bottom">
          <a>⚙ Settings</a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">

        {/* Top bar */}
        <header className="topbar">
          <div>
            <span className="page-label">DASHBOARD</span>
            <h1>Good morning 👋</h1>
          </div>

          <div className="profile">
            <div className="notification">🔔</div>
            <div className="avatar">P</div>
          </div>
        </header>

        {/* Welcome section */}
        <section className="hero">
          <div>
            <p className="small-text">Your hiring workspace</p>

            <h2>
              Build your next great team.
            </h2>

            <p>
              Manage jobs, candidates and interviews from one simple
              workspace.
            </p>
          </div>

          <button className="primary-btn">
            + Create New Job
          </button>
        </section>

        {/* Statistics */}
        <section className="stats">

          <div className="stat-card">
            <span>OPEN JOBS</span>
            <strong>12</strong>
            <small>+3 this month</small>
          </div>

          <div className="stat-card">
            <span>CANDIDATES</span>
            <strong>48</strong>
            <small>6 new candidates</small>
          </div>

          <div className="stat-card">
            <span>INTERVIEWS</span>
            <strong>18</strong>
            <small>4 scheduled today</small>
          </div>

          <div className="stat-card">
            <span>REPORTS</span>
            <strong>9</strong>
            <small>Ready for review</small>
          </div>

        </section>

        {/* Middle section */}
        <section className="content-grid">

          {/* Hiring process */}
          <div className="panel process-panel">

            <div className="panel-heading">
              <div>
                <h3>Hiring workflow</h3>
                <p>Track your candidate journey</p>
              </div>

              <span className="step-count">6 steps</span>
            </div>

            <div className="steps">

              {steps.map((step, index) => (
                <div className="step" key={step}>

                  <div className="step-number">
                    {index + 1}
                  </div>

                  <div>
                    <h4>{step}</h4>

                    <p>
                      {index === 0 &&
                        "Define the role and requirements."}

                      {index === 1 &&
                        "Add candidate resumes to the system."}

                      {index === 2 &&
                        "Review candidates against the role."}

                      {index === 3 &&
                        "Prepare questions for the interview."}

                      {index === 4 &&
                        "Conduct and record the interview."}

                      {index === 5 &&
                        "Generate an evaluation report."}
                    </p>
                  </div>

                </div>
              ))}

            </div>
          </div>

          {/* Quick actions */}
          <div className="panel actions-panel">

            <div className="panel-heading">
              <div>
                <h3>Quick actions</h3>
                <p>Get things done faster</p>
              </div>
            </div>

            <button className="action-btn">
              <span>💼</span>
              <div>
                <strong>Add job description</strong>
                <small>Create a new opening</small>
              </div>
            </button>

            <button className="action-btn">
              <span>📄</span>
              <div>
                <strong>Upload resume</strong>
                <small>Add a candidate CV</small>
              </div>
            </button>

            <button className="action-btn">
              <span>👥</span>
              <div>
                <strong>View candidates</strong>
                <small>Review your applicants</small>
              </div>
            </button>

            <div className="upload-box">
              <div className="upload-icon">↑</div>
              <strong>Drop your files here</strong>
              <p>PDF, DOC or TXT</p>
              <button>Choose file</button>
            </div>

          </div>

        </section>

        {/* Jobs */}
        <section className="panel jobs-panel">

          <div className="panel-heading">
            <div>
              <h3>Recent jobs</h3>
              <p>Your active hiring positions</p>
            </div>

            <button className="view-btn">
              View all →
            </button>
          </div>

          <div className="jobs-list">

            {jobs.map((job) => (
              <div className="job-row" key={job.title}>

                <div className="job-icon">
                  💼
                </div>

                <div className="job-info">
                  <h4>{job.title}</h4>
                  <p>{job.department}</p>
                </div>

                <div className="candidate-count">
                  <strong>{job.candidates}</strong>
                  <span>candidates</span>
                </div>

                <span className="status">
                  {job.status}
                </span>

                <button className="more-btn">
                  →
                </button>

              </div>
            ))}

          </div>

        </section>

      </main>
    </div>
  );
}