import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { db } from '../firebase.js'
import { interviewErrorMessage, startInterviewPlan } from '../services/interviews.js'

function reportScore(result) {
  return Number(result?.matchScore ?? result?.score ?? 0)
}

function ReportList({ items, emptyMessage }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="report-empty">{emptyMessage}</p>
  }

  return <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
}

export default function ScreeningReportPage() {
  const { screeningId, candidateId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [screening, setScreening] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [advancing, setAdvancing] = useState(false)
  const [advanceError, setAdvanceError] = useState('')
  const [existingInterviewId, setExistingInterviewId] = useState('')
  const comparisonUrl = `/screening?screeningId=${encodeURIComponent(screeningId || '')}`

  const advanceToInterview = async () => {
    setAdvancing(true)
    setAdvanceError('')
    try {
      const nextInterview = await startInterviewPlan(screeningId, candidateId)
      navigate(`/interviews/${nextInterview.interviewId}/plan`)
    } catch (actionError) {
      setAdvanceError(interviewErrorMessage(actionError))
      setAdvancing(false)
    }
  }

  useEffect(() => {
    if (!user?.uid || !screeningId || !candidateId) return undefined

    let active = true
    setLoading(true)
    setError('')

    getDoc(doc(db, 'screeningReports', screeningId))
      .then(snapshot => {
        if (!active) return
        if (!snapshot.exists()) {
          setError('This screening report could not be found.')
          return
        }

        const data = snapshot.data()
        if (data.ownerId !== user.uid) {
          setError('You do not have access to this screening report.')
          return
        }

        const candidateResult = Array.isArray(data.results)
          ? data.results.find(candidate => candidate.candidateId === candidateId)
          : null

        if (!candidateResult) {
          setError('This candidate report could not be found.')
          return
        }

        setScreening({ id: snapshot.id, ...data })
        setResult(candidateResult)
      })
      .catch(loadError => {
        if (!active) return
        console.error('Could not load candidate screening report:', loadError)
        setError('Could not load this screening report. Please try again.')
      })
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [candidateId, screeningId, user?.uid])

  useEffect(() => {
    if (!user?.uid || !screeningId || !candidateId) return undefined

    const interviewsQuery = query(
      collection(db, 'interviews'),
      where('ownerId', '==', user.uid),
    )

    return onSnapshot(
      interviewsQuery,
      snapshot => {
        const existingInterview = snapshot.docs.find(interviewDoc => {
          const interview = interviewDoc.data()
          return interview.screeningReportId === screeningId && interview.candidateId === candidateId
        })
        setExistingInterviewId(existingInterview?.id || '')
      },
      interviewLoadError => console.error('Could not load advanced interview state:', interviewLoadError),
    )
  }, [candidateId, screeningId, user?.uid])

  if (loading) {
    return (
      <div className="report-page">
        <header className="report-page__top"><Brand /></header>
        <main className="screening-report glass glass--strong report-state">Loading candidate report…</main>
      </div>
    )
  }

  if (error || !screening || !result) {
    return (
      <div className="report-page">
        <header className="report-page__top"><Brand /></header>
        <main className="screening-report glass glass--strong report-state">
          <h1>Report unavailable</h1>
          <p>{error || 'This candidate report could not be loaded.'}</p>
          <Link className="btn btn--primary" to={comparisonUrl}>Back to comparison</Link>
        </main>
      </div>
    )
  }

  const score = reportScore(result)
  const breakdown = result.scoreBreakdown || {}
  const skills = result.skills || {}

  return (
    <div className="report-page">
      <header className="report-page__top">
        <Brand />
      </header>

      <main className="screening-report glass glass--strong">
        <div className="screening-report__heading">
          <div>
            <span className="eyebrow">Candidate screening report</span>
            <h1>{result.candidateName}</h1>
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
          <section><h2>Matched skills</h2><ReportList items={skills.matched} emptyMessage="No matched skills were identified." /></section>
          <section><h2>Missing mandatory skills</h2><ReportList items={skills.missingMandatory} emptyMessage="No mandatory skills were identified as missing." /></section>
          <section><h2>Missing preferred skills</h2><ReportList items={skills.missingPreferred} emptyMessage="No preferred skills were identified as missing." /></section>
          <section><h2>Key strengths</h2><ReportList items={result.strengths} emptyMessage="No additional strengths were identified." /></section>
          <section className="report-grid__wide"><h2>Concerns</h2><ReportList items={result.concerns} emptyMessage="No specific concerns were identified." /></section>
        </div>

        <footer className="screening-report__foot">AI-generated screening support · Review before making hiring decisions</footer>
        {existingInterviewId && (
          <div className="interview-advanced-notice">
            <b>Already advanced to interview</b>
            <span>This candidate already has an interview workspace and cannot be advanced again.</span>
          </div>
        )}
        <div className="screening-report__actions">
          <Link className="btn" to={comparisonUrl}>← Back to comparison</Link>
          <div>
            <button className="btn" type="button" onClick={() => window.print()}>Print report</button>
            {existingInterviewId ? (
              <Link className="btn btn--primary" to={`/interviews/${existingInterviewId}/plan`}>Open interview plan</Link>
            ) : (
              <button className="btn btn--primary" type="button" onClick={advanceToInterview} disabled={advancing}>{advancing ? 'Preparing interview…' : 'Advance to interview'}</button>
            )}
          </div>
        </div>
        {advanceError && <div className="screening-report__action-error" role="alert">{advanceError}</div>}
      </main>
    </div>
  )
}
