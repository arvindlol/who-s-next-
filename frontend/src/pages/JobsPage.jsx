import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import {
  ACCEPTED_JOB_FILE_TYPES,
  closeJob,
  createJob,
  deleteJob,
  getJobFileUrl,
  reopenJob,
  subscribeToJobActivity,
  subscribeToJobs,
  validateJobFile,
} from '../services/jobs.js'

function formatDate(timestamp) {
  if (!timestamp?.toDate) return 'Just now'
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(timestamp.toDate())
}

function friendlyFirebaseError(error, fallback) {
  switch (error?.code) {
    case 'storage/unauthorized':
    case 'permission-denied':
      return 'Firebase denied this request. Check that the Firestore and Storage rules are deployed.'
    case 'storage/canceled':
      return 'The upload was cancelled.'
    case 'storage/retry-limit-exceeded':
    case 'storage/unknown':
      return 'The upload could not be completed. Check your connection and try again.'
    default:
      return fallback
  }
}

function UploadJobModal({ userId, initialFile, onClose }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(initialFile || null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef(null)

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, onClose])

  const submit = async event => {
    event.preventDefault()
    setError('')

    if (!title.trim()) return setError('Enter a job title.')
    const fileError = validateJobFile(file)
    if (fileError) return setError(fileError)

    setBusy(true)
    try {
      await createJob({ userId, title, file, onProgress: setProgress })
      onClose()
    } catch (uploadError) {
      setError(friendlyFirebaseError(uploadError, 'Could not upload the job description. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal__card job-modal glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="add-job-title">
        <div className="modal__head">
          <div>
            <h3 id="add-job-title">Add a job</h3>
            <p>Upload the job description that candidates will be evaluated against.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <form className="auth__form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="job-title">Job title</label>
            <input
              id="job-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Senior Backend Engineer"
              autoFocus
              disabled={busy}
            />
          </div>

          <div className="field">
            <label>Job description</label>
            <button
              className={`file-picker${file ? ' file-picker--selected' : ''}`}
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <span className="file-picker__icon">↑</span>
              <span>
                <b>{file ? file.name : 'Choose a document'}</b>
                <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF, DOC, DOCX or TXT · up to 10 MB'}</small>
              </span>
            </button>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept={ACCEPTED_JOB_FILE_TYPES}
              onChange={event => {
                setFile(event.target.files?.[0] || null)
                setError('')
              }}
              disabled={busy}
            />
          </div>

          {busy && (
            <div className="upload-progress" aria-label={`Upload ${progress}% complete`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          )}

          <span className="hint job-modal__error" role="alert">{error}</span>

          <div className="modal__actions">
            <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? `Uploading ${progress}%` : 'Upload job'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ViewJobModal({ job, onClose }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const isPdf = job.fileType === 'application/pdf' || job.originalFilename?.toLowerCase().endsWith('.pdf')

  useEffect(() => {
    let active = true
    getJobFileUrl(job.storagePath)
      .then(nextUrl => active && setUrl(nextUrl))
      .catch(viewError => active && setError(friendlyFirebaseError(viewError, 'Could not open this document.')))
    return () => { active = false }
  }, [job.storagePath])

  useEffect(() => {
    const closeOnEscape = event => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="modal__card job-viewer glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="view-job-title">
        <div className="modal__head">
          <div>
            <h3 id="view-job-title">{job.title}</h3>
            <p>{job.originalFilename} · {formatDate(job.createdAt)}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="job-viewer__body">
          {!url && !error && <div className="job-viewer__loading">Opening document…</div>}
          {error && <div className="jobs-message jobs-message--error">{error}</div>}
          {url && isPdf && <iframe title={`${job.title} job description`} src={url} />}
          {url && !isPdf && (
            <div className="job-viewer__fallback">
              <span className="file-picker__icon">↗</span>
              <b>Preview is not available for this file type.</b>
              <p>Open the original document to read the job description.</p>
            </div>
          )}
        </div>

        <div className="modal__actions">
          <button className="btn" type="button" onClick={onClose}>Close</button>
          {url && <a className="btn btn--primary" href={url} target="_blank" rel="noreferrer">Open original</a>}
        </div>
      </section>
    </div>
  )
}

function ManageJobModal({ job, stage, userId, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const completed = stage === 'completed'
  const canDelete = stage === 'new'

  const submit = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (confirmDelete) await deleteJob(job)
      else if (completed) await reopenJob(job.id)
      else await closeJob(job.id, userId)
      onClose()
    } catch (jobError) {
      const action = confirmDelete ? 'delete' : completed ? 'reopen' : 'close'
      setError(friendlyFirebaseError(jobError, `Could not ${action} this job.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal__card manage-job glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="manage-job-title">
        <div className="modal__head">
          <div>
            <span className="eyebrow">Manage job</span>
            <h3 id="manage-job-title">{confirmDelete ? 'Delete job' : completed ? 'Reopen job' : 'Close job'}</h3>
            <p>{job.title}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <form className="manage-job__form" onSubmit={submit}>
          {confirmDelete ? (
            <p>This permanently deletes the job description from Firestore and Firebase Storage. This action cannot be undone.</p>
          ) : completed ? (
            <p>Reopening this job will allow candidates to be selected again. Its stage will return to New or In progress based on existing activity.</p>
          ) : (
            <p>Closing this job marks its hiring process as completed. Existing candidates, reports, and interviews remain available.</p>
          )}

          {canDelete && !confirmDelete && (
            <div className="manage-job__danger-zone">
              <span>Permanently remove this unused job description.</span>
              <button className="manage-job__delete" type="button" onClick={() => { setConfirmDelete(true); setError('') }} disabled={busy}>
                Delete job
              </button>
            </div>
          )}

          <span className="hint manage-job__error" role="alert">{error}</span>
          <div className="modal__actions">
            {confirmDelete && (
              <button className="btn new-screening__back" type="button" onClick={() => { setConfirmDelete(false); setError('') }} disabled={busy}>← Back</button>
            )}
            <button className={`btn ${confirmDelete || !completed ? 'btn--danger' : 'btn--primary'}`} type="submit" disabled={busy}>
              {busy ? 'Saving…' : confirmDelete ? 'Delete permanently' : completed ? 'Reopen job' : 'Close job'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default function JobsPage() {
  const { user, signOut } = useAuth()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [activeJobIds, setActiveJobIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pendingUploadFile = location.state?.pendingUploadFile || null
  const [showUpload, setShowUpload] = useState(searchParams.get('new') === 'true' || Boolean(pendingUploadFile))
  const [viewingJob, setViewingJob] = useState(null)
  const [managingJob, setManagingJob] = useState(null)
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (!user?.uid) return undefined
    setLoading(true)
    return subscribeToJobs(
      user.uid,
      nextJobs => {
        setJobs(nextJobs)
        setLoading(false)
        setError('')
      },
      jobsError => {
        setError(friendlyFirebaseError(jobsError, 'Could not load your jobs. Please try again.'))
        setLoading(false)
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToJobActivity(
      user.uid,
      setActiveJobIds,
      activityError => console.error('Could not load job activity:', activityError),
    )
  }, [user?.uid])

  const readyJobs = useMemo(() => jobs.filter(job => job.status === 'ready'), [jobs])

  const closeUpload = () => {
    setShowUpload(false)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('new')
    const nextSearch = nextParams.toString()
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace: true, state: null },
    )
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

      <main className="page jobs-page">
        <section className="jobs-page__head">
          <div>
            <span className="eyebrow">Your workspace</span>
            <h1>Jobs</h1>
            <p>Manage the job descriptions used to screen and interview candidates.</p>
          </div>
          <button className="btn btn--primary jobs-page__add" onClick={() => setShowUpload(true)}>
            <span aria-hidden="true">＋</span> Add job
          </button>
        </section>

        {error && <div className="jobs-message jobs-message--error" role="alert">{error}</div>}

        <section className="jobs-table-wrap glass glass--lg" aria-live="polite">
          {loading ? (
            <div className="jobs-empty">
              <span className="jobs-empty__icon">···</span>
              <h2>Loading your jobs</h2>
              <p>Getting the latest job descriptions from your workspace.</p>
            </div>
          ) : jobs.length === 0 ? (
            <div className="jobs-empty">
              <span className="jobs-empty__icon">＋</span>
              <h2>No jobs yet</h2>
              <p>Add your first job description to begin evaluating candidates.</p>
              <button className="btn btn--primary" onClick={() => setShowUpload(true)}>Add your first job</button>
            </div>
          ) : (
            <div className="jobs-table-scroll">
              <table className="jobs-table">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>Title</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th><span className="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job, index) => {
                    const workflowStage = job.closedAt
                      ? 'completed'
                      : activeJobIds.has(job.id) ? 'in_progress' : 'new'
                    const displayedStatus = job.status === 'ready'
                      ? workflowStage
                      : job.status || 'uploading'
                    const statusLabel = {
                      new: 'New',
                      in_progress: 'In progress',
                      completed: 'Completed',
                      uploading: 'Uploading',
                      failed: 'Failed',
                    }[displayedStatus] || displayedStatus

                    return (
                    <tr key={job.id}>
                      <td data-label="S.No"><span className="job-serial">{index + 1}</span></td>
                      <td data-label="Title">
                        <b className="job-title">{job.title}</b>
                        <small>{job.originalFilename}</small>
                      </td>
                      <td data-label="Created">{formatDate(job.createdAt)}</td>
                      <td data-label="Status">
                        <span className={`job-status job-status--${displayedStatus}`}>
                          <span />{statusLabel}
                        </span>
                      </td>
                      <td className="jobs-table__actions">
                        <button
                          className="btn btn--small"
                          onClick={() => setViewingJob(job)}
                          disabled={job.status !== 'ready' || !job.storagePath}
                        >
                          View
                        </button>
                        {job.status === 'ready' && workflowStage !== 'completed' && (
                          <Link
                            className="btn btn--primary btn--small"
                            to={`/candidates?jobId=${encodeURIComponent(job.id)}&mode=select`}
                          >
                            Select candidates
                          </Link>
                        )}
                        {job.status === 'ready' && workflowStage === 'completed' && (
                          <Link
                            className="btn btn--primary btn--small"
                            to={`/reports?jobId=${encodeURIComponent(job.id)}`}
                          >
                            View reports
                          </Link>
                        )}
                        {job.status === 'ready' && (
                          <button
                            className="job-manage-btn"
                            type="button"
                            onClick={() => setManagingJob({ job, stage: workflowStage })}
                            aria-label={`Manage ${job.title}`}
                            title="Manage job"
                          >
                            ⋮
                          </button>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {!loading && readyJobs.length > 0 && (
          <p className="jobs-page__count">{readyJobs.length} ready job{readyJobs.length === 1 ? '' : 's'}</p>
        )}
      </main>

      <footer className="footer">Who’s Next assists interviewers. Hiring decisions stay with you.</footer>

      {showUpload && <UploadJobModal userId={user.uid} initialFile={pendingUploadFile} onClose={closeUpload} />}
      {viewingJob && <ViewJobModal job={viewingJob} onClose={() => setViewingJob(null)} />}
      {managingJob && (
        <ManageJobModal
          job={managingJob.job}
          stage={managingJob.stage}
          userId={user.uid}
          onClose={() => setManagingJob(null)}
        />
      )}
    </div>
  )
}
