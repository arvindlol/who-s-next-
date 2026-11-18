import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { firebaseErrorMessage } from '../services/errorMessages.js'
import {
  ACCEPTED_JOB_FILE_TYPES,
  closeJob,
  createJob,
  deleteJob,
  getJobFileUrl,
  jobNeedsPdf,
  reopenJob,
  subscribeToJobActivity,
  subscribeToJobs,
  validateJobFile,
} from '../services/jobs.js'
import { formatDate } from '../utils/format.js'

const STATUS_LABELS = {
  new: 'New',
  in_progress: 'In progress',
  completed: 'Completed',
  uploading: 'Uploading',
  failed: 'Failed',
  needs_pdf: 'Re-upload as PDF',
}

function useEscape(onEscape, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined
    const handler = event => event.key === 'Escape' && onEscape()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onEscape, enabled])
}

function UploadJobModal({ userId, initialFile, onClose }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(initialFile || null)
  const [criteria, setCriteria] = useState([{ id: 'criterion-1', text: '' }])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef(null)
  useEscape(onClose, !busy)

  const submit = async event => {
    event.preventDefault()
    setError('')
    if (!title.trim()) return setError('Enter a job title.')
    const fileError = validateJobFile(file)
    if (fileError) return setError(fileError)

    setBusy(true)
    try {
      const additionalCriteria = criteria
        .map(item => ({ ...item, text: item.text.trim().slice(0, 400) }))
        .filter(item => item.text)
      await createJob({ userId, title, file, additionalCriteria, onProgress: setProgress })
      onClose()
    } catch (uploadError) {
      setError(firebaseErrorMessage(uploadError, 'Could not upload the job description. Please try again.'))
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
            <p>Upload the job description (PDF) that candidates will be evaluated against.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <form className="auth__form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="job-title">Job title</label>
            <input id="job-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="Senior Backend Engineer" maxLength={150} autoFocus disabled={busy} />
          </div>

          <div className="field">
            <label htmlFor="job-file">Job description</label>
            <button className={`file-picker${file ? ' file-picker--selected' : ''}`} type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
              <span className="file-picker__icon">↑</span>
              <span>
                <b>{file ? file.name : 'Choose a PDF'}</b>
                <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF only · up to 10 MB'}</small>
              </span>
            </button>
            <input
              id="job-file"
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

          <div className="field job-criteria-field">
            <div className="job-criteria-field__head">
              <div>
                <label>Additional hiring criteria <span>(optional)</span></label>
                <small>Add verbal requirements, benchmarks, or interview focus areas. They are used in screening and interview planning.</small>
              </div>
              <button
                className="job-criteria-field__add"
                type="button"
                onClick={() => setCriteria(current => [...current, { id: `criterion-${Date.now()}-${current.length}`, text: '' }])}
                disabled={busy || criteria.length >= 20}
              >
                ＋ Add point
              </button>
            </div>
            <div className="job-criteria-field__list">
              {criteria.map((criterion, index) => (
                <div className="job-criteria-field__row" key={criterion.id}>
                  <span aria-hidden="true">{index + 1}.</span>
                  <textarea
                    value={criterion.text}
                    onChange={event => setCriteria(current => current.map(item => (item.id === criterion.id ? { ...item, text: event.target.value } : item)))}
                    placeholder="Enter a qualification, benchmark, or interview instruction"
                    aria-label={`Additional hiring criterion ${index + 1}`}
                    rows="2"
                    maxLength={400}
                    disabled={busy}
                  />
                  {criteria.length > 1 && (
                    <button type="button" onClick={() => setCriteria(current => current.filter(item => item.id !== criterion.id))} aria-label={`Remove criterion ${index + 1}`} title="Remove point" disabled={busy}>×</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {busy && <div className="upload-progress" aria-label={`Upload ${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>}
          <span className="hint job-modal__error" role="alert">{error}</span>

          <div className="modal__actions">
            <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? `Uploading ${progress}%` : 'Upload job'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ViewJobModal({ job, onClose }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const isPdf = !jobNeedsPdf(job)
  const criteria = Array.isArray(job.additionalCriteria)
    ? job.additionalCriteria.map(item => (typeof item === 'string' ? item : item?.text)).filter(text => text?.trim())
    : []
  useEscape(onClose)

  useEffect(() => {
    let active = true
    getJobFileUrl(job.storagePath)
      .then(nextUrl => active && setUrl(nextUrl))
      .catch(viewError => active && setError(firebaseErrorMessage(viewError, 'Could not open this document.')))
    return () => { active = false }
  }, [job.storagePath])

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={`modal__card job-viewer${criteria.length === 0 ? ' job-viewer--without-criteria' : ''} glass glass--strong`} role="dialog" aria-modal="true" aria-labelledby="view-job-title">
        <div className="modal__head">
          <div>
            <h3 id="view-job-title">{job.title}</h3>
            <p>{job.originalFilename} · {formatDate(job.createdAt, 'Just now')}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {criteria.length > 0 && (
          <section className="job-viewer__criteria">
            <b>Additional hiring criteria</b>
            <ol>{criteria.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ol>
          </section>
        )}

        <div className="job-viewer__body">
          {!url && !error && <div className="job-viewer__loading">Opening document…</div>}
          {error && <div className="jobs-message jobs-message--error">{error}</div>}
          {url && isPdf && <iframe title={`${job.title} job description`} src={url} />}
          {url && !isPdf && (
            <div className="job-viewer__fallback">
              <span className="file-picker__icon">↗</span>
              <b>This job description is not a PDF.</b>
              <p>Open the original, then upload it again as a PDF so candidates can be screened against it.</p>
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
  // A failed upload can only be deleted.
  const [confirmDelete, setConfirmDelete] = useState(job.status === 'failed')
  const completed = stage === 'completed'
  useEscape(onClose, !busy)

  const submit = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (confirmDelete) await deleteJob(job.id)
      else if (completed) await reopenJob(job.id)
      else await closeJob(job.id, userId)
      onClose()
    } catch (jobError) {
      const action = confirmDelete ? 'delete' : completed ? 'reopen' : 'close'
      setError(firebaseErrorMessage(jobError, `Could not ${action} this job. Please try again.`))
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
            <p>This permanently deletes the job description file, every screening for this job, and its interviews and reports. Candidates stay on your list. This cannot be undone.</p>
          ) : completed ? (
            <p>Reopening this job lets you screen candidates for it again.</p>
          ) : (
            <p>Closing this job marks its hiring process as completed. Existing screenings, interviews and reports remain available.</p>
          )}

          <span className="hint manage-job__error" role="alert">{error}</span>
          <div className="modal__actions">
            {!confirmDelete && (
              <button className="manage-job__delete" type="button" onClick={() => { setConfirmDelete(true); setError('') }} disabled={busy}>Delete job</button>
            )}
            {confirmDelete && job.status !== 'failed' && (
              <button className="btn new-screening__back" type="button" onClick={() => { setConfirmDelete(false); setError('') }} disabled={busy}>Back</button>
            )}
            <button className={`btn ${confirmDelete || !completed ? 'btn--danger' : 'btn--primary'}`} type="submit" disabled={busy}>
              {busy ? (confirmDelete ? 'Deleting…' : 'Saving…') : confirmDelete ? 'Delete permanently' : completed ? 'Reopen job' : 'Close job'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default function JobsPage() {
  const { user } = useAuth()
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

  useEffect(() => {
    if (!user?.uid) return undefined
    setLoading(true)
    return subscribeToJobs(
      user.uid,
      next => {
        setJobs(next)
        setLoading(false)
        setError('')
      },
      jobsError => {
        setError(firebaseErrorMessage(jobsError, 'Could not load your jobs. Please try again.'))
        setLoading(false)
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToJobActivity(user.uid, setActiveJobIds, activityError => console.error('Could not load job activity:', activityError))
  }, [user?.uid])

  const readyJobs = useMemo(() => jobs.filter(job => job.status === 'ready'), [jobs])

  const closeUpload = () => {
    setShowUpload(false)
    const params = new URLSearchParams(searchParams)
    params.delete('new')
    const search = params.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true, state: null })
  }

  return (
    <AppLayout mainClassName="page jobs-page">
      <section className="jobs-page__head">
        <div>
          <span className="eyebrow">Your workspace</span>
          <h1>Jobs</h1>
          <p>Manage the job descriptions used to screen and interview candidates.</p>
        </div>
        <button className="btn btn--primary jobs-page__add" onClick={() => setShowUpload(true)}><span aria-hidden="true">＋</span> Add job</button>
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
              <thead><tr><th>S.No</th><th>Title</th><th>Created</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {jobs.map((job, index) => {
                  const needsPdf = job.status === 'ready' && jobNeedsPdf(job)
                  const stage = job.closedAt ? 'completed' : activeJobIds.has(job.id) ? 'in_progress' : 'new'
                  const displayed = job.status !== 'ready' ? job.status || 'uploading' : needsPdf ? 'needs_pdf' : stage

                  return (
                    <tr key={job.id}>
                      <td data-label="S.No"><span className="job-serial">{index + 1}</span></td>
                      <td data-label="Title"><b className="job-title">{job.title}</b><small>{job.originalFilename}</small></td>
                      <td data-label="Created">{formatDate(job.createdAt, 'Just now')}</td>
                      <td data-label="Status">
                        <span className={`job-status job-status--${needsPdf ? 'failed' : displayed}`}><span />{STATUS_LABELS[displayed] || displayed}</span>
                      </td>
                      <td className="jobs-table__actions">
                        <button className="btn btn--small" onClick={() => setViewingJob(job)} disabled={job.status !== 'ready' || !job.storagePath}>View</button>
                        {job.status === 'ready' && !needsPdf && stage !== 'completed' && (
                          <Link className="btn btn--primary btn--small" to={`/screening?new=true&jobId=${encodeURIComponent(job.id)}`}>Screen candidates</Link>
                        )}
                        {job.status === 'ready' && stage !== 'new' && (
                          <Link className="btn btn--small" to={`/reports?jobId=${encodeURIComponent(job.id)}`}>Reports</Link>
                        )}
                        {(job.status === 'ready' || job.status === 'failed') && (
                          <button className="job-manage-btn" type="button" onClick={() => setManagingJob({ job, stage })} aria-label={`Manage ${job.title}`} title="Manage job">⋮</button>
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

      {!loading && readyJobs.length > 0 && <p className="jobs-page__count">{readyJobs.length} ready job{readyJobs.length === 1 ? '' : 's'}</p>}

      {showUpload && <UploadJobModal userId={user.uid} initialFile={pendingUploadFile} onClose={closeUpload} />}
      {viewingJob && <ViewJobModal job={viewingJob} onClose={() => setViewingJob(null)} />}
      {managingJob && <ManageJobModal job={managingJob.job} stage={managingJob.stage} userId={user.uid} onClose={() => setManagingJob(null)} />}
    </AppLayout>
  )
}
