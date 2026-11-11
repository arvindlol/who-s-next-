import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { db, functions } from '../firebase.js'
import { subscribeToJobs } from '../services/jobs.js'
import { interviewErrorMessage, startInterviewPlan } from '../services/interviews.js'

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function getResumeName(resume, candidateId) {
  try {
    const url = new URL(resume)
    const encodedObjectPath = url.pathname.split('/o/').pop() || ''
    const objectPath = decodeURIComponent(encodedObjectPath)
    const filename = objectPath.split('/').pop() || ''
    return filename.startsWith(`${candidateId}-`)
      ? filename.slice(candidateId.length + 1)
      : filename || 'Uploaded resume'
  } catch {
    const filename = decodeURIComponent(resume.split('/').pop()?.split('?')[0] || '')
    return filename.startsWith(`${candidateId}-`)
      ? filename.slice(candidateId.length + 1)
      : filename || 'Uploaded resume'
  }
}

function resultScore(result) {
  return Number(result.matchScore ?? result.score ?? 0)
}

function advancedInterviewKey(screeningId, candidateId) {
  return `${screeningId}:${candidateId}`
}

function displayMatchCount(count) {
  return Number(count) === 0 ? '-' : count
}

function screeningErrorMessage(error) {
  const code = error?.code || ''
  const backendMessage = typeof error?.message === 'string' ? error.message : ''
  const normalizedMessage = backendMessage.toLowerCase()

  if (code === 'functions/unauthenticated') {
    return 'Your sign-in session has expired. Sign in again before running the screening.'
  }

  if (code === 'functions/resource-exhausted') {
    return 'Your Gemini quota is currently exhausted or billing is unavailable. Check the key in Profile and try again later.'
  }

  if (code === 'functions/permission-denied') {
    if (normalizedMessage.includes('gemini api key')) {
      return 'Your saved Gemini API key is invalid, expired, blocked, or lacks Gemini access. Replace it in Profile and try again.'
    }

    return 'The selected job or candidate is unavailable to your account. Refresh the page and select your own uploads.'
  }

  if (code === 'functions/failed-precondition') {
    if (normalizedMessage.includes('api key') || normalizedMessage.includes('decrypt')) {
      return 'Your saved Gemini API key is missing or could not be opened. Save the key again from Profile.'
    }

    return 'One of the selected files is missing, too large, or not a valid PDF. Re-upload the JD or resume and try again.'
  }

  if (code === 'functions/not-found') {
    return 'A selected JD or resume could not be downloaded. Re-upload the missing PDF and try again.'
  }

  if (code === 'functions/invalid-argument') {
    return 'The screening selection is invalid. Choose one job and exactly 2 or 3 different candidates.'
  }

  if (code === 'functions/deadline-exceeded') {
    return 'Gemini took too long to complete the screening. Please wait a moment and try again.'
  }

  if (code === 'functions/data-loss') {
    return 'Gemini returned an incomplete or inconsistent result. Please run the comparison again.'
  }

  if (code === 'functions/unavailable') {
    if (normalizedMessage.includes('report could not be saved')) {
      return 'The screening finished, but the report could not be saved. Please try again.'
    }

    if (normalizedMessage.includes('temporarily busy')) {
      return 'Gemini is temporarily busy. The system retried automatically, but the screening could not finish. Please try again shortly.'
    }

    return 'The screening service or Gemini could not be reached. Check your connection and try again.'
  }

  if (code === 'functions/internal') {
    if (normalizedMessage.includes('report could not be saved')) {
      return 'The screening finished, but the report could not be saved. Please try again.'
    }

    return 'The screening service is not configured correctly. Please contact the project administrator.'
  }

  return 'The screening could not be completed. Check your connection and try again.'
}

function screeningProgressLabel(progress) {
  if (progress >= 100) return 'Screening complete'
  if (progress >= 90) return 'Validating and saving the report'
  if (progress >= 45) return 'Gemini is analyzing and ranking candidates'
  if (progress >= 20) return 'Reading the selected PDF documents'
  return 'Preparing the job and candidate files'
}

function buildScreeningSummary(screening) {
  const results = screening.results || []
  const supplied = screening.screeningSummary || {}
  const best = [...results].sort((a, b) => resultScore(b) - resultScore(a))[0]
  const excellentMatches = results.filter(result => resultScore(result) >= 90).length
  const strongMatches = results.filter(result => resultScore(result) >= 75 && resultScore(result) < 90).length
  const moderateMatches = results.filter(result => resultScore(result) >= 60 && resultScore(result) < 75).length
  const weakMatches = results.filter(result => resultScore(result) >= 40 && resultScore(result) < 60).length
  const poorMatches = results.filter(result => resultScore(result) < 40).length

  return {
    totalCandidates: supplied.totalCandidates ?? results.length,
    excellentMatches: supplied.excellentMatches ?? excellentMatches,
    strongMatches: supplied.strongMatches ?? strongMatches,
    moderateMatches: supplied.moderateMatches ?? moderateMatches,
    weakMatches: supplied.weakMatches ?? weakMatches,
    poorMatches: supplied.poorMatches ?? poorMatches,
    bestCandidate: supplied.bestCandidate || best?.candidateName || best?.name || 'Not available',
    bestCandidateScore: supplied.bestCandidateScore ?? (best ? resultScore(best) : 0),
    overview: supplied.overview || `${excellentMatches + strongMatches + moderateMatches} of ${results.length} candidates show at least a moderate fit for this role. Review the individual reports before making an interview decision.`,
  }
}

function CandidateReportDetails({ screening, result }) {
  const score = resultScore(result)
  const breakdown = result.scoreBreakdown || {}
  const skills = result.skills || {}
  const renderList = (items, emptyMessage) => (
    Array.isArray(items) && items.length > 0
      ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
      : <p className="report-empty">{emptyMessage}</p>
  )

  return (
    <div className="screening-candidate-report">
      <div className="screening-report__heading">
        <div>
          <span className="eyebrow">Candidate screening report</span>
          <h2>{result.candidateName || result.name}</h2>
          <p>{screening.jobTitle} · {result.resumeName || 'Uploaded resume'}</p>
        </div>
        <div className={`report-score report-score--${score >= 75 ? 'high' : score >= 60 ? 'medium' : 'low'}`}>
          <b>{score}</b><span>Match score</span>
        </div>
      </div>

      <div className="report-summary">
        <span>{result.matchLevel}</span>
        <b>{result.recommendation}</b>
        <p>{result.summary}</p>
      </div>

      <section className="report-breakdown">
        <h3>Score breakdown</h3>
        <div>
          <article><b>{breakdown.requiredSkills ?? 0}<small>/35</small></b><span>Required skills</span></article>
          <article><b>{breakdown.relevantExperience ?? 0}<small>/35</small></b><span>Relevant experience</span></article>
          <article><b>{breakdown.roleSimilarity ?? 0}<small>/20</small></b><span>Role similarity</span></article>
          <article><b>{breakdown.preferredSkills ?? 0}<small>/10</small></b><span>Preferred skills</span></article>
        </div>
      </section>

      <section className="report-experience">
        <h3>Experience match</h3>
        <p>{result.experienceMatch}</p>
      </section>

      <div className="report-grid">
        <section><h2>Matched skills</h2>{renderList(skills.matched, 'No matched skills were identified.')}</section>
        <section><h2>Missing mandatory skills</h2>{renderList(skills.missingMandatory, 'No mandatory skills were identified as missing.')}</section>
        <section><h2>Missing preferred skills</h2>{renderList(skills.missingPreferred, 'No preferred skills were identified as missing.')}</section>
        <section><h2>Key strengths</h2>{renderList(result.strengths, 'No additional strengths were identified.')}</section>
        <section className="report-grid__wide"><h2>Concerns</h2>{renderList(result.concerns, 'No specific concerns were identified.')}</section>
      </div>
    </div>
  )
}

function ScreeningResultsModal({ screening, advancedInterviews, onAdvance, onOpenInterview, onClose }) {
  const summary = buildScreeningSummary(screening)
  const [selectedResult, setSelectedResult] = useState(null)
  const [actionCandidate, setActionCandidate] = useState(null)
  const [advancingId, setAdvancingId] = useState('')
  const [advanceError, setAdvanceError] = useState('')

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      if (actionCandidate) setActionCandidate(null)
      else if (selectedResult) setSelectedResult(null)
      else onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [actionCandidate, onClose, selectedResult])

  const openCandidateActions = result => {
    const resultId = result.candidateId || result.id
    setActionCandidate({ result, resultId })
  }

  const advanceToInterview = async result => {
    const resultId = result.candidateId || result.id
    setAdvancingId(resultId)
    setAdvanceError('')
    try {
      await onAdvance(screening, result)
    } catch (error) {
      setAdvanceError(interviewErrorMessage(error))
      setAdvancingId('')
    }
  }

  const interviewFor = result => advancedInterviews.get(
    advancedInterviewKey(screening.id, result?.candidateId || result?.id),
  )

  const selectedInterview = selectedResult ? interviewFor(selectedResult) : null
  const actionInterview = actionCandidate ? interviewFor(actionCandidate.result) : null

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="modal__card screening-results glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="screening-results-title">
        <div className="modal__head">
          <div>
            <span className="eyebrow">{selectedResult ? 'Individual report' : 'Screening results'}</span>
            <h3 id="screening-results-title">{selectedResult ? selectedResult.candidateName : screening.jobTitle}</h3>
            <p>{selectedResult ? screening.jobTitle : `${screening.results.length} candidates compared · ${formatDate(screening.createdAt)}${screening.saved ? ' · Saved' : screening.preview ? ' · Preview only' : ''}`}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {selectedResult ? (
          <CandidateReportDetails screening={screening} result={selectedResult} />
        ) : (
          <div className="screening-results__body">
          <div className="screening-results__candidates">
            <div className="screening-results__section-head">
              <div><span className="eyebrow">Ranked results</span><h4>Candidate comparison</h4></div>
              <span>{screening.results.length} evaluated</span>
            </div>
            <div className="screening-results__table-wrap">
              <table className="screening-results__table">
                <thead>
                  <tr>
                    <th>Candidate</th><th>Resume</th><th>Score</th><th>Recommendation</th>
                    <th><span className="visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {screening.results.map(result => {
                    const score = resultScore(result)
                    const resultId = result.candidateId || result.id
                    return (
                      <tr key={resultId}>
                        <td><b>{result.candidateName || result.name}</b></td>
                        <td>{result.resumeName || 'Uploaded resume'}</td>
                        <td><span className={`score score--${score >= 75 ? 'high' : score >= 60 ? 'medium' : 'low'}`}>{score}%</span></td>
                        <td>{result.recommendation}</td>
                        <td>
                          <button
                            className="screening-row-actions__trigger"
                            type="button"
                            aria-label={`Actions for ${result.candidateName || result.name}`}
                            aria-haspopup="dialog"
                            aria-expanded={actionCandidate?.resultId === resultId}
                            onClick={() => openCandidateActions(result)}
                          >
                            ⋮
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="screening-summary">
            <div className="screening-results__section-head">
              <div><span className="eyebrow">At a glance</span><h4>Screening summary</h4></div>
            </div>

            <div className="screening-summary__stats">
              <div><b>{summary.totalCandidates}</b><span>Evaluated</span></div>
              <div><b>{displayMatchCount(summary.excellentMatches)}</b><span>Excellent</span></div>
              <div><b>{displayMatchCount(summary.strongMatches)}</b><span>Strong</span></div>
              <div><b>{displayMatchCount(summary.moderateMatches)}</b><span>Moderate</span></div>
              <div><b>{displayMatchCount(summary.weakMatches)}</b><span>Weak</span></div>
              <div><b>{displayMatchCount(summary.poorMatches)}</b><span>Poor</span></div>
            </div>

            <div className="screening-summary__best">
              <span>Top candidate</span>
              <b>{summary.bestCandidate}</b>
              <strong>{summary.bestCandidateScore}% match</strong>
            </div>

            <p className="screening-summary__overview">{summary.overview}</p>
          </aside>
          </div>
        )}

        {selectedResult && (
          <div>
            {selectedInterview && (
              <div className="interview-advanced-notice">
                <b>Already advanced to interview</b>
                <span>This candidate already has an interview workspace and cannot be advanced again.</span>
              </div>
            )}
            <div className="modal__actions">
              <button className="btn new-screening__back" type="button" onClick={() => setSelectedResult(null)}>← Back to comparison</button>
              {selectedInterview ? (
                <button className="btn btn--primary" type="button" onClick={() => onOpenInterview(selectedInterview.id)}>Open interview plan</button>
              ) : (
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={() => advanceToInterview(selectedResult)}
                  disabled={Boolean(advancingId)}
                >
                  {advancingId ? 'Preparing interview…' : 'Advance to interview'}
                </button>
              )}
            </div>
            {advanceError && <div className="candidate-action-dialog__error" role="alert">{advanceError}</div>}
          </div>
        )}
        {actionCandidate && createPortal(
          <div
            className="candidate-action-overlay"
            onMouseDown={event => event.target === event.currentTarget && setActionCandidate(null)}
          >
            <section
              className="candidate-action-dialog glass glass--strong"
              role="dialog"
              aria-modal="true"
              aria-labelledby="candidate-action-title"
            >
              <div className="modal__head">
                <div>
                  <span className="eyebrow">Candidate actions</span>
                  <h3 id="candidate-action-title">{actionCandidate.result.candidateName || actionCandidate.result.name}</h3>
                  <p>{screening.jobTitle}</p>
                </div>
                <button className="icon-btn" type="button" onClick={() => setActionCandidate(null)} aria-label="Close candidate actions">×</button>
              </div>

              <div className="candidate-action-dialog__summary">
                <div className={`candidate-action-dialog__score score--${resultScore(actionCandidate.result) >= 75 ? 'high' : resultScore(actionCandidate.result) >= 60 ? 'medium' : 'low'}`}>
                  <b>{resultScore(actionCandidate.result)}%</b>
                  <span>Match score</span>
                </div>
                <div>
                  <h4>{actionInterview ? 'Already advanced to interview' : 'Ready for the next stage?'}</h4>
                  <p>{actionInterview
                    ? 'This candidate already has an interview workspace. Open it to continue preparing or reviewing the interview plan.'
                    : 'Advance this candidate to prepare a structured interview plan. The interview itself remains outside Who’s Next; you can add its transcript later.'}</p>
                </div>
              </div>

              {actionInterview && (
                <div className="interview-advanced-notice">
                  <b>Interview workspace created</b>
                  <span>The candidate cannot be advanced a second time.</span>
                </div>
              )}

              <div className="modal__actions candidate-action-dialog__actions">
                {screening.inlineReports ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setActionCandidate(null)
                      setSelectedResult(actionCandidate.result)
                    }}
                  >
                    View report
                  </button>
                ) : (
                  <Link
                    className="btn"
                    to={`/screening/${screening.id}/report/${actionCandidate.resultId}`}
                    onClick={() => setActionCandidate(null)}
                  >
                    View report
                  </Link>
                )}
                {actionInterview ? (
                  <button className="btn btn--primary" type="button" onClick={() => onOpenInterview(actionInterview.id)}>Open interview plan</button>
                ) : (
                  <button className="btn btn--primary" type="button" onClick={() => advanceToInterview(actionCandidate.result)} disabled={Boolean(advancingId)}>
                    {advancingId ? 'Preparing interview…' : 'Advance to interview'}
                  </button>
                )}
              </div>
              {advanceError && <div className="candidate-action-dialog__error" role="alert">{advanceError}</div>}
            </section>
          </div>,
          document.body,
        )}
      </section>
    </div>
  )
}

function NewScreeningModal({
  jobs,
  candidates,
  candidatesLoading,
  candidatesError,
  initialJobId = '',
  onCreate,
  onComplete,
  onClose,
}) {
  const [step, setStep] = useState(initialJobId ? 2 : 1)
  const [jobId, setJobId] = useState(initialJobId)
  const [candidateIds, setCandidateIds] = useState([])
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!preparing) return undefined

    const progressTimer = window.setInterval(() => {
      setProgress(current => {
        if (current >= 94) return 94
        if (current < 20) return Math.min(20, current + 4)
        if (current < 50) return Math.min(50, current + 3)
        if (current < 80) return Math.min(80, current + 2)
        return current + 1
      })
    }, 700)

    return () => window.clearInterval(progressTimer)
  }, [preparing])

  const toggleCandidate = candidateId => {
    if (candidateIds.includes(candidateId)) {
      setCandidateIds(current => current.filter(id => id !== candidateId))
      setError('')
      return
    }

    if (candidateIds.length >= 3) {
      setError('You can select a maximum of 3 candidates.')
      return
    }

    setCandidateIds(current => [...current, candidateId])
    setError('')
  }

  const submit = async event => {
    event.preventDefault()
    if (!jobId) return setError('Select a job description.')
    const job = jobs.find(item => item.id === jobId)
    if (!job) return setError('The selected job is unavailable. Close this window and try again.')
    if (candidateIds.length < 2 || candidateIds.length > 3) {
      return setError('Select 2 or 3 candidates for screening.')
    }
    const selectedCandidates = candidates.filter(candidate => candidateIds.includes(candidate.id))

    setProgress(0)
    setPreparing(true)
    setError('')
    window.requestAnimationFrame(() => setProgress(4))

    try {
      const completedScreening = await onCreate(job, selectedCandidates)
      setProgress(100)
      await new Promise(resolve => window.setTimeout(resolve, 500))
      onClose()
      onComplete(completedScreening)
    } catch (submitError) {
      setProgress(0)
      setError(screeningErrorMessage(submitError))
    } finally {
      setPreparing(false)
    }
  }

  const continueToResumes = () => {
    if (!jobId) return setError('Select a job description to continue.')
    setError('')
    setStep(2)
  }

  const selectedJob = jobs.find(job => job.id === jobId)
  const returnToScreening = `/screening?new=true&jobId=${encodeURIComponent(jobId)}`
  const uploadResumeUrl = `/candidates?new=true&returnTo=${encodeURIComponent(returnToScreening)}`

  return (
    <div className="modal" onMouseDown={event => !preparing && event.target === event.currentTarget && onClose()}>
      <section className="modal__card new-screening glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="new-screening-title">
        <div className="modal__head">
          <div>
            <h3 id="new-screening-title">New comparison</h3>
            <p>{step === 1 ? 'First, choose the job description.' : `Now choose resumes for ${selectedJob?.title || 'this job'}.`}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close" disabled={preparing}>×</button>
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
              <div className="new-screening__legend"><span>Select candidate resumes</span><Link to={uploadResumeUrl}>Upload new resume</Link></div>
              <div className="candidate-selection">
                {candidatesLoading ? (
                  <div className="selection-empty">Loading uploaded candidate resumes…</div>
                ) : candidatesError ? (
                  <div className="selection-empty">{candidatesError}</div>
                ) : candidates.length === 0 ? (
                  <div className="selection-empty">No uploaded candidate resumes are available.</div>
                ) : candidates.map(candidate => (
                  <label className={`selection-row${candidateIds.includes(candidate.id) ? ' selection-row--selected' : ''}`} key={candidate.id}>
                    <input type="checkbox" checked={candidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} />
                    <span><b>{candidate.name}</b><small>{candidate.resumeName}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {preparing && (
            <div
              className="screening-progress"
              role="progressbar"
              aria-label="Screening progress"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={progress}
            >
              <div className="screening-progress__status">
                <span>{screeningProgressLabel(progress)}</span>
                <b>{progress}%</b>
              </div>
              <div className="screening-progress__track"><span style={{ width: `${progress}%` }} /></div>
              <small>Keep this window open while the comparison is running.</small>
            </div>
          )}
          <span className="hint new-screening__error" role="alert">{error}</span>
          <div className="modal__actions new-screening__actions">
            {step === 2 && (
              <button className="btn new-screening__back" type="button" onClick={() => { setStep(1); setError('') }} disabled={preparing}>← Back</button>
            )}
            {step === 1 ? (
              <button className="btn btn--primary" type="button" onClick={continueToResumes} disabled={!jobId}>Continue</button>
            ) : (
              <button
                className="btn btn--primary"
                type="submit"
                disabled={candidateIds.length < 2 || candidateIds.length > 3 || preparing}
              >
                {preparing ? `Screening candidates… ${progress}%` : `Start comparison (${candidateIds.length})`}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}

export default function ScreeningPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [screenings, setScreenings] = useState([])
  const [screeningsLoading, setScreeningsLoading] = useState(true)
  const [screeningsError, setScreeningsError] = useState('')
  const [jobs, setJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(true)
  const [candidatesError, setCandidatesError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [selectedScreening, setSelectedScreening] = useState(null)
  const [advancedInterviews, setAdvancedInterviews] = useState(new Map())
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()
  const requestedJobId = searchParams.get('jobId') || ''
  const requestedScreeningId = searchParams.get('screeningId') || ''

  useEffect(() => {
    if (searchParams.get('new') === 'true') setShowNew(true)
  }, [searchParams])

  const closeNewComparison = () => {
    setShowNew(false)

    if (searchParams.get('new') !== 'true' && !searchParams.has('jobId')) return

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('new')
    nextSearchParams.delete('jobId')
    setSearchParams(nextSearchParams, { replace: true })
  }

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToJobs(user.uid, nextJobs => setJobs(nextJobs.filter(job => job.status === 'ready')), console.error)
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined

    const interviewsQuery = query(
      collection(db, 'interviews'),
      where('ownerId', '==', user.uid),
    )

    return onSnapshot(
      interviewsQuery,
      snapshot => {
        const nextInterviews = new Map()
        snapshot.docs.forEach(interviewDoc => {
          const interview = interviewDoc.data()
          if (!interview.screeningReportId || !interview.candidateId) return
          nextInterviews.set(
            advancedInterviewKey(interview.screeningReportId, interview.candidateId),
            { id: interviewDoc.id, ...interview },
          )
        })
        setAdvancedInterviews(nextInterviews)
      },
      error => console.error('Could not load advanced interview state:', error),
    )
  }, [user?.uid])

  useEffect(() => {
    if (!requestedScreeningId || screeningsLoading) return

    const requestedScreening = screenings.find(screening => screening.id === requestedScreeningId)
    if (requestedScreening) setSelectedScreening(requestedScreening)
  }, [requestedScreeningId, screenings, screeningsLoading])

  const closeScreeningResults = () => {
    setSelectedScreening(null)
    if (!searchParams.has('screeningId')) return

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('screeningId')
    setSearchParams(nextSearchParams, { replace: true })
  }

  useEffect(() => {
    if (!user?.uid) return undefined

    setScreeningsLoading(true)
    setScreeningsError('')

    const reportsQuery = query(
      collection(db, 'screeningReports'),
      where('ownerId', '==', user.uid),
    )

    return onSnapshot(
      reportsQuery,
      snapshot => {
        const savedScreenings = snapshot.docs
          .map(reportDoc => {
            const data = reportDoc.data()
            return {
              id: reportDoc.id,
              jobId: data.jobId || '',
              jobTitle: data.jobTitle || 'Untitled job',
              createdAt: data.createdAt?.toMillis?.() || 0,
              results: Array.isArray(data.results) ? data.results : [],
              screeningSummary: data.screeningSummary || {},
              status: data.status || 'completed',
              saved: true,
            }
          })
          .sort((first, second) => second.createdAt - first.createdAt)

        setScreenings(savedScreenings)
        setScreeningsLoading(false)
      },
      error => {
        console.error('Could not load saved screening reports:', error)
        setScreenings([])
        setScreeningsError('Could not load saved screening reports. Please try again.')
        setScreeningsLoading(false)
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined

    setCandidatesLoading(true)
    setCandidatesError('')

    const candidatesQuery = query(
      collection(db, 'candidates'),
      where('ownerId', '==', user.uid),
    )

    return onSnapshot(
      candidatesQuery,
      snapshot => {
        const uploadedCandidates = snapshot.docs
          .map(candidateDoc => {
            const data = candidateDoc.data()
            const resume = typeof data.resume === 'string' ? data.resume.trim() : ''

            return {
              id: candidateDoc.id,
              name: data.name || 'Unnamed candidate',
              resume,
              resumeName: resume ? getResumeName(resume, candidateDoc.id) : '',
            }
          })
          .filter(candidate => candidate.resume)

        setCandidates(uploadedCandidates)
        setCandidatesLoading(false)
      },
      error => {
        console.error('Could not load candidate resumes for screening:', error)
        setCandidates([])
        setCandidatesError('Could not load uploaded candidate resumes. Please try again.')
        setCandidatesLoading(false)
      },
    )
  }, [user?.uid])

  const createScreening = async (job, selectedCandidates) => {
    const prepareScreening = httpsCallable(functions, 'prepareScreening', {
      timeout: 3_600_000,
    })
    const response = await prepareScreening({
      jobId: job.id,
      candidateIds: selectedCandidates.map(candidate => candidate.id),
    })

    const testResult = response.data.geminiTest
    const savedReport = response.data.report
    const selectedCandidatesById = new Map(
      selectedCandidates.map(candidate => [candidate.id, candidate]),
    )
    const previewResults = testResult.candidates.map(candidate => ({
      ...candidate,
      resumeName: selectedCandidatesById.get(candidate.candidateId)?.resumeName || 'Uploaded resume',
    }))

    return {
      id: savedReport.id,
      jobId: job.id,
      jobTitle: job.title,
      createdAt: savedReport.createdAt,
      results: previewResults,
      screeningSummary: testResult.screeningSummary,
      saved: true,
    }
  }

  const advanceCandidate = async (screening, result) => {
    const candidateId = result.candidateId || result.id
    const nextInterview = await startInterviewPlan(screening.id, candidateId)
    navigate(`/interviews/${nextInterview.interviewId}/plan`)
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
          <div className="screening-history__head"><h2>Recent comparisons</h2><span>{screeningsLoading ? 'Loading…' : `${screenings.length} total`}</span></div>
          <div className="screening-history__scroll">
            <table className="screening-history__table">
              <thead><tr><th>Date</th><th>Job</th><th>Candidates</th><th>Status</th><th><span className="visually-hidden">Action</span></th></tr></thead>
              <tbody>
                {screeningsLoading ? (
                  <tr><td className="screening-history__empty" colSpan="5">Loading saved comparisons…</td></tr>
                ) : screeningsError ? (
                  <tr><td className="screening-history__empty" colSpan="5">{screeningsError}</td></tr>
                ) : screenings.length === 0 ? (
                  <tr><td className="screening-history__empty" colSpan="5">No saved comparisons yet.</td></tr>
                ) : screenings.map(screening => (
                  <tr key={screening.id}>
                    <td>{formatDate(screening.createdAt)}</td>
                    <td><b>{screening.jobTitle}</b></td>
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
      {showNew && (
        <NewScreeningModal
          jobs={jobs}
          candidates={candidates}
          candidatesLoading={candidatesLoading}
          candidatesError={candidatesError}
          initialJobId={requestedJobId}
          onCreate={createScreening}
          onComplete={setSelectedScreening}
          onClose={closeNewComparison}
        />
      )}
      {selectedScreening && (
        <ScreeningResultsModal
          screening={selectedScreening}
          advancedInterviews={advancedInterviews}
          onAdvance={advanceCandidate}
          onOpenInterview={interviewId => navigate(`/interviews/${interviewId}/plan`)}
          onClose={closeScreeningResults}
        />
      )}
    </div>
  )
}
