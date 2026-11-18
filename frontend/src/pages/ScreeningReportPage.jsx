import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import Brand from '../components/Brand.jsx'
import ScreeningReportView from '../components/ScreeningReportView.jsx'
import { useAuth } from '../auth.jsx'
import { db } from '../firebase.js'
import {
  interviewErrorMessage,
  interviewKey,
  latestInterviewsByCandidate,
  startInterviewPlan,
  subscribeToInterviews,
} from '../services/interviews.js'

export default function ScreeningReportPage() {
  const { screeningId, candidateId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [screening, setScreening] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [interviews, setInterviews] = useState([])
  const [advancing, setAdvancing] = useState(false)
  const [advanceError, setAdvanceError] = useState('')
  const comparisonUrl = `/screening?screeningId=${encodeURIComponent(screeningId || '')}`

  useEffect(() => {
    if (!user?.uid || !screeningId || !candidateId) return undefined
    let active = true
    setLoading(true)
    setError('')

    getDoc(doc(db, 'screeningReports', screeningId))
      .then(snapshot => {
        if (!active) return
        const data = snapshot.exists() ? snapshot.data() : null
        if (!data || data.ownerId !== user.uid) return setError('This screening report could not be found.')
        const candidateResult = (data.results || []).find(item => item.candidateId === candidateId)
        if (!candidateResult) return setError('This candidate’s report could not be found.')
        setScreening({ id: snapshot.id, ...data })
        setResult(candidateResult)
      })
      .catch(loadError => {
        if (!active) return
        console.error('Could not load the screening report:', loadError)
        setError('Could not load this screening report. Please try again.')
      })
      .finally(() => active && setLoading(false))

    return () => { active = false }
  }, [candidateId, screeningId, user?.uid])

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToInterviews(user.uid, setInterviews, loadError => console.error('Could not load interviews:', loadError))
  }, [user?.uid])

  const existingInterview = useMemo(
    () => (screening ? latestInterviewsByCandidate(interviews).get(interviewKey(screening.jobId, candidateId)) : null),
    [interviews, screening, candidateId],
  )

  const advance = async () => {
    setAdvancing(true)
    setAdvanceError('')
    try {
      const { interviewId } = await startInterviewPlan(screeningId, candidateId)
      navigate(`/interviews/${interviewId}/plan`)
    } catch (actionError) {
      setAdvanceError(interviewErrorMessage(actionError, 'Could not prepare the interview. Please try again.'))
      setAdvancing(false)
    }
  }

  if (loading || error || !screening || !result) {
    return (
      <div className="report-page">
        <header className="report-page__top"><Brand /></header>
        <main className="screening-report glass glass--strong report-state">
          {loading ? 'Loading candidate report…' : (
            <>
              <h1>Report unavailable</h1>
              <p>{error || 'This candidate report could not be loaded.'}</p>
              <Link className="btn btn--primary" to={comparisonUrl}>Back to comparison</Link>
            </>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="report-page">
      <header className="report-page__top"><Brand /></header>
      <main className="screening-report glass glass--strong">
        <ScreeningReportView jobTitle={screening.jobTitle} result={result} headingLevel="h1" />

        <footer className="screening-report__foot">AI-generated screening support · Review before making hiring decisions</footer>
        {existingInterview && (
          <div className="interview-advanced-notice">
            <b>Already advanced to interview</b>
            <span>This candidate already has an interview workspace for this job.</span>
          </div>
        )}
        <div className="screening-report__actions">
          <Link className="btn" to={comparisonUrl}>← Back to comparison</Link>
          <div>
            <button className="btn" type="button" onClick={() => window.print()}>Print report</button>
            {existingInterview ? (
              <Link className="btn btn--primary" to={existingInterview.plan ? `/interviews/${existingInterview.id}/review` : `/interviews/${existingInterview.id}/plan`}>Open interview</Link>
            ) : (
              <button className="btn btn--primary" type="button" onClick={advance} disabled={advancing}>{advancing ? 'Preparing interview…' : 'Advance to interview'}</button>
            )}
          </div>
        </div>
        {advanceError && <div className="screening-report__action-error" role="alert">{advanceError}</div>}
      </main>
    </div>
  )
}
