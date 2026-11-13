import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import ScreeningReportView, { resultScore } from '../components/ScreeningReportView.jsx'
import { useAuth } from '../auth.jsx'
import { subscribeToCandidates } from '../services/candidates.js'
import { callableErrorMessage } from '../services/errorMessages.js'
import {
  interviewErrorMessage,
  interviewKey,
  latestInterviewsByCandidate,
  startInterviewPlan,
  subscribeToInterviews,
} from '../services/interviews.js'
import { jobNeedsPdf, subscribeToJobs } from '../services/jobs.js'
import { SCREENING_STAGES, newScreeningId, runScreening, subscribeToScreenings } from '../services/screening.js'
import { formatDate, scoreTone } from '../utils/format.js'

const MIN_CANDIDATES = 1
const MAX_CANDIDATES = 5

const displayCount = count => (Number(count) === 0 ? '–' : count)

function ScreeningResultsModal({ screening, interviews, onAdvance, onClose }) {
  const summary = screening.screeningSummary || {}
  const [selectedResult, setSelectedResult] = useState(null)
  const [actionResult, setActionResult] = useState(null)
  const [advancingId, setAdvancingId] = useState('')
  const [advanceError, setAdvanceError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      if (actionResult) setActionResult(null)
      else if (selectedResult) setSelectedResult(null)
      else onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [actionResult, onClose, selectedResult])

  const interviewFor = result => interviews.get(interviewKey(screening.jobId, result?.candidateId))

  const advance = async result => {
    setAdvancingId(result.candidateId)
    setAdvanceError('')
    try {
      await onAdvance(screening, result)
    } catch (error) {
      setAdvanceError(interviewErrorMessage(error, 'Could not prepare the interview. Please try again.'))
      setAdvancingId('')
    }
  }

  const openInterview = interview => navigate(interview.plan ? `/interviews/${interview.id}/review` : `/interviews/${interview.id}/plan`)

  const renderAdvanceButton = result => {
    const interview = interviewFor(result)
    return interview ? (
      <button className="btn btn--primary" type="button" onClick={() => openInterview(interview)}>Open interview</button>
    ) : (
      <button className="btn btn--primary" type="button" onClick={() => advance(result)} disabled={Boolean(advancingId)}>
        {advancingId === result.candidateId ? 'Preparing interview…' : 'Advance to interview'}
      </button>
    )
  }

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="modal__card screening-results glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="screening-results-title">
        <div className="modal__head">
          <div>
            <span className="eyebrow">{selectedResult ? 'Individual report' : 'Screening results'}</span>
            <h3 id="screening-results-title">{selectedResult ? selectedResult.candidateName : screening.jobTitle}</h3>
            <p>{selectedResult ? screening.jobTitle : `${screening.results.length} candidate${screening.results.length === 1 ? '' : 's'} compared · ${formatDate(screening.createdAt)}`}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {selectedResult ? (
          <>
            <ScreeningReportView jobTitle={screening.jobTitle} result={selectedResult} />
            {interviewFor(selectedResult) && (
              <div className="interview-advanced-notice">
                <b>Already advanced to interview</b>
                <span>This candidate already has an interview workspace for this job.</span>
              </div>
            )}
            <div className="modal__actions">
              <button className="btn new-screening__back" type="button" onClick={() => setSelectedResult(null)}>← Back to comparison</button>
              {renderAdvanceButton(selectedResult)}
            </div>
            {advanceError && <div className="candidate-action-dialog__error" role="alert">{advanceError}</div>}
          </>
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
                    <tr><th>#</th><th>Candidate</th><th>Score</th><th>Recommendation</th><th><span className="visually-hidden">Action</span></th></tr>
                  </thead>
                  <tbody>
                    {screening.results.map(result => {
                      const score = resultScore(result)
                      return (
                        <tr key={result.candidateId}>
                          <td>{result.rank}</td>
                          <td><b>{result.candidateName}</b><small>{result.resumeName || 'Uploaded resume'}</small></td>
                          <td><span className={`score score--${scoreTone(score)}`}>{score}%</span></td>
                          <td>{result.recommendation}</td>
                          <td>
                            <button
                              className="screening-row-actions__trigger"
                              type="button"
                              aria-label={`Actions for ${result.candidateName}`}
                              aria-haspopup="dialog"
                              onClick={() => setActionResult(result)}
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
                <div><b>{summary.totalCandidates ?? screening.results.length}</b><span>Evaluated</span></div>
                <div><b>{displayCount(summary.excellentMatches)}</b><span>Excellent</span></div>
                <div><b>{displayCount(summary.strongMatches)}</b><span>Strong</span></div>
                <div><b>{displayCount(summary.moderateMatches)}</b><span>Moderate</span></div>
                <div><b>{displayCount(summary.weakMatches)}</b><span>Weak</span></div>
                <div><b>{displayCount(summary.poorMatches)}</b><span>Poor</span></div>
              </div>
              {summary.bestCandidate && (
                <div className="screening-summary__best">
                  <span>Top candidate</span>
                  <b>{summary.bestCandidate}</b>
                  <strong>{summary.bestCandidateScore}% match</strong>
                </div>
              )}
              <p className="screening-summary__overview">{summary.overview}</p>
            </aside>
          </div>
        )}

        {actionResult && createPortal(
          <div className="candidate-action-overlay" onMouseDown={event => event.target === event.currentTarget && setActionResult(null)}>
            <section className="candidate-action-dialog glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="candidate-action-title">
              <div className="modal__head">
                <div>
                  <span className="eyebrow">Candidate actions</span>
                  <h3 id="candidate-action-title">{actionResult.candidateName}</h3>
                  <p>{screening.jobTitle}</p>
                </div>
                <button className="icon-btn" type="button" onClick={() => setActionResult(null)} aria-label="Close candidate actions">×</button>
              </div>

              <div className="candidate-action-dialog__summary">
                <div className={`candidate-action-dialog__score score--${scoreTone(resultScore(actionResult))}`}>
                  <b>{resultScore(actionResult)}%</b>
                  <span>Match score</span>
                </div>
                <div>
                  <h4>{interviewFor(actionResult) ? 'Already advanced to interview' : 'Ready for the next stage?'}</h4>
                  <p>{interviewFor(actionResult)
                    ? 'This candidate already has an interview workspace for this job. Open it to continue.'
                    : 'Advance this candidate to prepare a structured interview plan. The interview itself happens outside Who’s Next; you add its transcript afterwards.'}</p>
                </div>
              </div>

              <div className="modal__actions candidate-action-dialog__actions">
                <Link className="btn" to={`/screening/${screening.id}/report/${actionResult.candidateId}`} onClick={() => setActionResult(null)}>Full report</Link>
                <button className="btn" type="button" onClick={() => { setSelectedResult(actionResult); setActionResult(null) }}>View here</button>
                {renderAdvanceButton(actionResult)}
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

function NewScreeningModal({ jobs, candidates, candidatesLoading, candidatesError, initialJobId, runningScreening, onCreate, onComplete, onClose }) {
  const [step, setStep] = useState(initialJobId ? 2 : 1)
  const [jobId, setJobId] = useState(initialJobId)
  const [candidateIds, setCandidateIds] = useState([])
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [running, startedAt])

  const toggleCandidate = id => {
    setError('')
    if (candidateIds.includes(id)) {
      setCandidateIds(current => current.filter(item => item !== id))
    } else if (candidateIds.length >= MAX_CANDIDATES) {
      setError(`You can compare up to ${MAX_CANDIDATES} candidates at a time.`)
    } else {
      setCandidateIds(current => [...current, id])
    }
  }

  const submit = async event => {
    event.preventDefault()
    const job = jobs.find(item => item.id === jobId)
    if (!job) return setError('Select a job description.')
    if (candidateIds.length < MIN_CANDIDATES) return setError('Select at least one candidate.')

    setRunning(true)
    setStartedAt(Date.now())
    setElapsed(0)
    setError('')
    try {
      const reportId = await onCreate(job, candidateIds)
      onComplete(reportId)
    } catch (submitError) {
      setError(callableErrorMessage(submitError, 'The screening could not be completed. Please try again.'))
      setRunning(false)
    }
  }

  const selectedJob = jobs.find(job => job.id === jobId)
  const returnToScreening = `/screening?new=true&jobId=${encodeURIComponent(jobId)}`
  const addCandidateUrl = `/candidates?new=true&returnTo=${encodeURIComponent(returnToScreening)}`
  const stage = SCREENING_STAGES[runningScreening?.stage] || SCREENING_STAGES.preparing

  return (
    <div className="modal" onMouseDown={event => !running && event.target === event.currentTarget && onClose()}>
      <section className="modal__card new-screening glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="new-screening-title">
        <div className="modal__head">
          <div>
            <h3 id="new-screening-title">New screening</h3>
            <p>{step === 1 ? 'First, choose the job description.' : `Now choose 1–${MAX_CANDIDATES} candidates for ${selectedJob?.title || 'this job'}.`}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close" disabled={running}>×</button>
        </div>

        <div className="new-screening__steps" aria-label={`Step ${step} of 2`}>
          <span className="new-screening__step new-screening__step--active"><b>1</b> Job description</span>
          <span className={`new-screening__step${step === 2 ? ' new-screening__step--active' : ''}`}><b>2</b> Candidates</span>
        </div>

        <form onSubmit={submit} className="new-screening__form">
          {step === 1 ? (
            <fieldset>
              <div className="new-screening__legend"><span>Select a job description</span><Link to="/jobs?new=true">Upload new JD</Link></div>
              {jobs.length === 0 ? (
                <div className="selection-empty">No open PDF job descriptions are ready. Upload one first.</div>
              ) : jobs.map(job => (
                <label className={`selection-row${jobId === job.id ? ' selection-row--selected' : ''}`} key={job.id}>
                  <input type="radio" name="job" value={job.id} checked={jobId === job.id} onChange={() => { setJobId(job.id); setError('') }} />
                  <span><b>{job.title}</b><small>{job.originalFilename}</small></span>
                </label>
              ))}
            </fieldset>
          ) : (
            <fieldset disabled={running}>
              <div className="new-screening__legend"><span>Select candidates with a PDF resume</span><Link to={addCandidateUrl}>Add a candidate</Link></div>
              <div className="candidate-selection">
                {candidatesLoading ? (
                  <div className="selection-empty">Loading candidates…</div>
                ) : candidatesError ? (
                  <div className="selection-empty">{candidatesError}</div>
                ) : candidates.length === 0 ? (
                  <div className="selection-empty">No candidates have a resume yet. Add a PDF resume on the Candidates page.</div>
                ) : candidates.map(candidate => (
                  <label className={`selection-row${candidateIds.includes(candidate.id) ? ' selection-row--selected' : ''}`} key={candidate.id}>
                    <input type="checkbox" checked={candidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} />
                    <span><b>{candidate.name}</b><small>{candidate.resumeName || 'Resume on file'}{candidate.role ? ` · ${candidate.role}` : ''}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {running && (
            <div className="screening-progress" role="progressbar" aria-label="Screening progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stage.percent} aria-valuetext={stage.label}>
              <div className="screening-progress__status">
                <span>{stage.label}</span>
                <b>{elapsed}s</b>
              </div>
              <div className="screening-progress__track"><span style={{ width: `${stage.percent}%` }} /></div>
              <small>This usually takes under two minutes. You can close this window — the report will appear in your list when it’s ready.</small>
            </div>
          )}

          <span className="hint new-screening__error" role="alert">{error}</span>

          <div className="modal__actions new-screening__actions">
            {step === 2 && !running && (
              <button className="btn new-screening__back" type="button" onClick={() => { setStep(1); setError('') }}>← Back</button>
            )}
            {step === 1 ? (
              <button className="btn btn--primary" type="button" onClick={() => (jobId ? setStep(2) : setError('Select a job description to continue.'))} disabled={!jobId}>Continue</button>
            ) : running ? (
              <button className="btn" type="button" onClick={onClose}>Run in background</button>
            ) : (
              <button className="btn btn--primary" type="submit" disabled={candidateIds.length < MIN_CANDIDATES}>
                {`Start screening (${candidateIds.length})`}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}

export default function ScreeningPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [screenings, setScreenings] = useState([])
  const [screeningsLoading, setScreeningsLoading] = useState(true)
  const [screeningsError, setScreeningsError] = useState('')
  const [jobs, setJobs] = useState([])
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(true)
  const [candidatesError, setCandidatesError] = useState('')
  const [interviews, setInterviews] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [runningId, setRunningId] = useState('')
  const requestedJobId = searchParams.get('jobId') || ''

  useEffect(() => {
    if (searchParams.get('new') === 'true') setShowNew(true)
    const screeningId = searchParams.get('screeningId')
    if (screeningId) setSelectedId(screeningId)
  }, [searchParams])

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToJobs(
      user.uid,
      next => setJobs(next.filter(job => job.status === 'ready' && !job.closedAt && !jobNeedsPdf(job))),
      error => console.error('Could not load jobs:', error),
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToInterviews(user.uid, setInterviews, error => console.error('Could not load interviews:', error))
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    setScreeningsLoading(true)
    return subscribeToScreenings(
      user.uid,
      next => {
        setScreenings(next)
        setScreeningsError('')
        setScreeningsLoading(false)
      },
      error => {
        console.error('Could not load screenings:', error)
        setScreeningsError('Could not load saved screenings. Please refresh and try again.')
        setScreeningsLoading(false)
      },
    )
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    setCandidatesLoading(true)
    return subscribeToCandidates(
      user.uid,
      next => {
        setCandidates(next.filter(candidate => candidate.resumePath))
        setCandidatesError('')
        setCandidatesLoading(false)
      },
      error => {
        console.error('Could not load candidates:', error)
        setCandidatesError('Could not load candidates. Please try again.')
        setCandidatesLoading(false)
      },
    )
  }, [user?.uid])

  const interviewsByCandidate = useMemo(() => latestInterviewsByCandidate(interviews), [interviews])
  const selectedScreening = screenings.find(screening => screening.id === selectedId && screening.status === 'completed') || null
  const runningScreening = screenings.find(screening => screening.id === runningId) || null

  const clearParams = (...keys) => {
    if (!keys.some(key => searchParams.has(key))) return
    const next = new URLSearchParams(searchParams)
    keys.forEach(key => next.delete(key))
    setSearchParams(next, { replace: true })
  }

  const closeNew = () => {
    setShowNew(false)
    clearParams('new', 'jobId')
  }

  const closeResults = () => {
    setSelectedId('')
    clearParams('screeningId')
  }

  const createScreening = async (job, candidateIds) => {
    const reportId = newScreeningId()
    setRunningId(reportId)
    try {
      await runScreening({ reportId, jobId: job.id, candidateIds })
      return reportId
    } finally {
      setRunningId('')
    }
  }

  const advanceCandidate = async (screening, result) => {
    const { interviewId } = await startInterviewPlan(screening.id, result.candidateId)
    navigate(`/interviews/${interviewId}/plan`)
  }

  return (
    <AppLayout mainClassName="page screening-page" footer="Screening results support interviewer judgement and do not make hiring decisions.">
      <section className="screening-page__head">
        <div>
          <span className="eyebrow">Candidate evaluation</span>
          <h1>Candidate Screening</h1>
          <p>Compare 1–{MAX_CANDIDATES} resumes with a job description and review each candidate’s report.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowNew(true)}>＋ New screening</button>
      </section>

      <p className="privacy-note">
        Resumes and job descriptions are sent to Google Gemini using your own API key. On Gemini’s free tier, Google may use submitted content to improve its products — use a paid key for candidate data.
      </p>

      <section className="screening-history glass glass--lg">
        <div className="screening-history__head"><h2>Recent screenings</h2><span>{screeningsLoading ? 'Loading…' : `${screenings.length} total`}</span></div>
        <div className="screening-history__scroll">
          <table className="screening-history__table">
            <thead><tr><th>Date</th><th>Job</th><th>Candidates</th><th>Status</th><th><span className="visually-hidden">Action</span></th></tr></thead>
            <tbody>
              {screeningsLoading ? (
                <tr><td className="screening-history__empty" colSpan="5">Loading saved screenings…</td></tr>
              ) : screeningsError ? (
                <tr><td className="screening-history__empty" colSpan="5">{screeningsError}</td></tr>
              ) : screenings.length === 0 ? (
                <tr><td className="screening-history__empty" colSpan="5">No screenings yet.</td></tr>
              ) : screenings.map(screening => (
                <tr key={screening.id}>
                  <td>{formatDate(screening.createdAt, 'Just now')}</td>
                  <td><b>{screening.jobTitle}</b></td>
                  <td>{screening.status === 'completed' ? screening.results.length : screening.candidateIds.length}</td>
                  <td>
                    {screening.status === 'completed'
                      ? <span className="job-status job-status--ready"><span />Completed</span>
                      : <span className="job-status job-status--uploading"><span />{(SCREENING_STAGES[screening.stage] || SCREENING_STAGES.preparing).label}</span>}
                  </td>
                  <td>
                    <button className="btn btn--small" onClick={() => setSelectedId(screening.id)} disabled={screening.status !== 'completed'}>View screening</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showNew && (
        <NewScreeningModal
          jobs={jobs}
          candidates={candidates}
          candidatesLoading={candidatesLoading}
          candidatesError={candidatesError}
          initialJobId={jobs.some(job => job.id === requestedJobId) ? requestedJobId : ''}
          runningScreening={runningScreening}
          onCreate={createScreening}
          onComplete={reportId => {
            closeNew()
            setSelectedId(reportId)
          }}
          onClose={closeNew}
        />
      )}

      {selectedScreening && (
        <ScreeningResultsModal
          screening={selectedScreening}
          interviews={interviewsByCandidate}
          onAdvance={advanceCandidate}
          onClose={closeResults}
        />
      )}
    </AppLayout>
  )
}
