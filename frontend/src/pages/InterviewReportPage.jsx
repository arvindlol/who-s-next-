import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { db } from '../firebase.js'
import { interviewErrorMessage, recordInterviewDecision } from '../services/interviews.js'

const DECISIONS = [
  'Move to offer',
  'Move to next stage',
  'Another interview',
  'Do not progress',
]

function scoreLabel(score) {
  return score === null || score === undefined ? 'Not covered' : `${Number(score).toFixed(1)} / 5`
}

function statusLabel(value) {
  return String(value || '').replace(/_/g, ' ')
}

export default function InterviewReportPage() {
  const { interviewId } = useParams()
  const { user, signOut } = useAuth()
  const [reportDocument, setReportDocument] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [decision, setDecision] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [savingDecision, setSavingDecision] = useState(false)
  const [decisionMessage, setDecisionMessage] = useState('')
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (!user?.uid || !interviewId) return undefined
    return onSnapshot(
      doc(db, 'interviewReports', interviewId),
      snapshot => {
        if (!snapshot.exists() || snapshot.get('ownerId') !== user.uid) {
          setLoadError('This final interview report could not be found.')
          setLoading(false)
          return
        }
        const next = { id: snapshot.id, ...snapshot.data() }
        setReportDocument(next)
        if (next.humanDecision) {
          setDecision(next.humanDecision.decision || '')
          setDecisionNote(next.humanDecision.note || '')
        }
        setLoadError('')
        setLoading(false)
      },
      error => {
        console.error('Could not load interview report:', error)
        setLoadError('Could not load this final report. Please try again.')
        setLoading(false)
      },
    )
  }, [interviewId, user?.uid])

  const report = reportDocument?.report
  const groupedQuestions = useMemo(() => {
    const groups = new Map()
    ;(report?.questions || []).forEach(question => {
      if (!groups.has(question.area)) groups.set(question.area, [])
      groups.get(question.area).push(question)
    })
    return [...groups.entries()]
  }, [report?.questions])

  const saveDecision = async event => {
    event.preventDefault()
    if (!decision || savingDecision) return
    setSavingDecision(true)
    setDecisionMessage('')
    try {
      await recordInterviewDecision(interviewId, decision, decisionNote)
      setDecisionMessage('Recruiter decision saved.')
    } catch (error) {
      console.error('Could not save recruiter decision:', error)
      setDecisionMessage(interviewErrorMessage(error, 'Could not save the recruiter decision. Please try again.'))
    } finally {
      setSavingDecision(false)
    }
  }

  if (loading) {
    return <div className="report-page"><main className="screening-report glass glass--strong report-state">Loading final interview report…</main></div>
  }

  if (loadError || !reportDocument) {
    return (
      <div className="report-page">
        <main className="screening-report glass glass--strong report-state">
          <h1>Report unavailable</h1><p>{loadError}</p>
          <Link className="btn btn--primary" to={`/interviews/${interviewId}/transcript`}>Back to transcript</Link>
        </main>
      </div>
    )
  }

  if (reportDocument.status === 'queued' || reportDocument.status === 'generating') {
    return <Navigate replace to={`/interviews/${interviewId}/transcript`} />
  }

  if (reportDocument.status === 'failed' || !report) {
    return (
      <div className="report-page">
        <main className="screening-report glass glass--strong report-state">
          <h1>Report generation stopped</h1>
          <p>{reportDocument.error?.message || 'The report could not be generated. Return to the transcript and try again.'}</p>
          <Link className="btn btn--primary" to={`/interviews/${interviewId}/transcript`}>Return to transcript</Link>
        </main>
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="topbar glass glass--strong">
        <Brand />
        <nav>
          <NavLink to="/" end>Overview</NavLink><NavLink to="/jobs">Jobs</NavLink><NavLink to="/candidates">Candidates</NavLink>
          <NavLink to="/screening">Screening</NavLink><NavLink to="/interviews">Interviews</NavLink><NavLink to="/reports">Reports</NavLink>
        </nav>
        <span className="spacer" />
        <NavLink to="/profile" className="avatar" title={user?.email}>{initials}</NavLink>
        <button className="btn btn--ghost" onClick={signOut}>Log out</button>
      </header>

      <main className="page interview-report-page">
        <Link className="interview-plan__back" to="/interviews">← Interviews</Link>

        <header className="interview-report__head">
          <div>
            <span className="eyebrow">Final interview report</span>
            <h1>{reportDocument.candidateName}</h1>
            <p>{reportDocument.jobTitle} · Plan v{reportDocument.sourcePlanVersion} · Transcript v{reportDocument.sourceTranscriptVersion}</p>
          </div>
          <div className="interview-report__score" aria-label={`Overall score ${scoreLabel(report.overallScore)}`}>
            <strong>{report.overallScore === null ? '—' : Number(report.overallScore).toFixed(1)}</strong>
            <span>Overall score</span>
          </div>
        </header>

        <section className="interview-report__overview">
          <article className="glass glass--lg report-advisory">
            <span className="eyebrow">AI suggestion · Advisory only</span>
            <h2>{report.aiSuggestion.decision}</h2>
            <p>{report.aiSuggestion.reason}</p>
            <small>The recruiter remains responsible for the hiring decision.</small>
          </article>
          <article className="glass glass--lg report-metric">
            <span>Plan coverage</span>
            <strong>{report.planCoverage.covered} of {report.planCoverage.total}</strong>
            <small>{report.planCoverage.notCoveredQuestions.length === 0 ? 'Every planned question was covered' : `${report.planCoverage.notCoveredQuestions.length} question(s) not covered`}</small>
          </article>
          <article className="glass glass--lg report-metric">
            <span>Evidence strength</span>
            <strong>{report.evidenceStrength.level}</strong>
            <small>{report.evidenceStrength.reason}</small>
          </article>
        </section>

        <section className="glass glass--lg interview-report__summary">
          <span className="eyebrow">Hiring-manager summary</span>
          <p>{report.summary}</p>
        </section>

        <div className="interview-report__columns">
          <section className="interview-report__main">
            <section>
              <div className="section__head"><h2>Topic and area scores</h2></div>
              <div className="report-area-grid">
                {report.scoresByArea.map(area => (
                  <article className="glass glass--lg" key={area.area}>
                    <span>{area.area}</span><strong>{scoreLabel(area.score)}</strong><small>{statusLabel(area.status)}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="report-question-section">
              <div className="section__head"><h2>Question-by-question evaluation</h2></div>
              {groupedQuestions.map(([area, questions]) => (
                <section className="report-question-group" key={area}>
                  <h3>{area}</h3>
                  {questions.map(question => (
                    <article className="glass glass--lg report-question" key={question.number}>
                      <span className="generated-plan__number">{question.number}</span>
                      <div>
                        <div className="report-question__head">
                          <span>{question.topic}</span><b>{scoreLabel(question.score)}</b>
                        </div>
                        {question.status === 'not_covered' ? (
                          <p className="report-question__empty">This planned question was not covered, so it was not scored.</p>
                        ) : (
                          <>
                            <p>{question.whatTheySaid}</p>
                            {question.evidenceQuotes.map(quote => <blockquote key={quote}>“{quote}”</blockquote>)}
                            <div className="report-question__guide">
                              <div><b>Guide points evidenced</b><ul>{question.pointsHit.map(point => <li key={point}>{point}</li>)}</ul></div>
                              <div><b>Guide points missing</b><ul>{question.pointsMissed.map(point => <li key={point}>{point}</li>)}</ul></div>
                            </div>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              ))}
            </section>
          </section>

          <aside className="interview-report__sidebar">
            <section className="glass glass--lg report-list-card">
              <span className="eyebrow">Strengths</span>
              {report.strengths.length === 0 ? <p>No clear strengths were evidenced.</p> : report.strengths.map(item => (
                <article key={`${item.title}-${item.question}`}><h3>{item.title}</h3><p>{item.description}</p><blockquote>“{item.quote}”</blockquote><small>Question {item.question}</small></article>
              ))}
            </section>

            <section className="glass glass--lg report-list-card report-list-card--concerns">
              <span className="eyebrow">Concerns and follow-ups</span>
              {report.concerns.length === 0 ? <p>No material concerns identified.</p> : report.concerns.map(item => (
                <article key={item.title}><h3>{item.title}</h3><p>{item.explanation}</p><small>Follow-up: {item.suggestedFollowUp}</small></article>
              ))}
            </section>

            <section className="glass glass--lg report-list-card">
              <span className="eyebrow">Critical topics</span>
              {report.criticalTopicChecks.map(item => (
                <article key={item.topic}><h3>{item.topic}</h3><p>{scoreLabel(item.score)} · {statusLabel(item.status)}</p>{item.evidenceQuote && <blockquote>“{item.evidenceQuote}”</blockquote>}</article>
              ))}
            </section>

            {report.resumeProbeResults.length > 0 && (
              <section className="glass glass--lg report-list-card">
                <span className="eyebrow">Resume points checked</span>
                {report.resumeProbeResults.map(item => (
                  <article key={item.point}><h3>{item.point}</h3><p>{item.finding}</p><small>{statusLabel(item.status)} · Questions {item.questionNumbers.join(', ')}</small></article>
                ))}
              </section>
            )}

            {report.interviewerNoteObservations.length > 0 && (
              <section className="glass glass--lg report-list-card report-note-context">
                <span className="eyebrow">Recruiter-note context · Unscored</span>
                {report.interviewerNoteObservations.map((item, index) => (
                  <article key={`${item.observation}-${index}`}><p>{item.observation}</p><small>Follow-up: {item.followUp}</small></article>
                ))}
              </section>
            )}

            <section className="glass glass--lg report-list-card">
              <span className="eyebrow">Data-quality warnings</span>
              {report.dataQualityFlags.length === 0 ? <p>No reliability warnings identified.</p> : <ul>{report.dataQualityFlags.map(flag => <li key={flag}>{flag}</li>)}</ul>}
            </section>

            <form className="glass glass--lg recruiter-decision" onSubmit={saveDecision}>
              <span className="eyebrow">Human recruiter decision</span>
              <h2>Record your decision</h2>
              <p>This is the final human decision and remains separate from the AI suggestion.</p>
              <label><span>Decision</span><select value={decision} onChange={event => setDecision(event.target.value)} required><option value="">Choose a decision</option>{DECISIONS.map(item => <option key={item}>{item}</option>)}</select></label>
              <label><span>Decision note (optional)</span><textarea value={decisionNote} onChange={event => setDecisionNote(event.target.value)} maxLength="1000" placeholder="Add the job-related reason for your decision." /></label>
              <button className="btn btn--primary" disabled={!decision || savingDecision}>{savingDecision ? 'Saving…' : reportDocument.humanDecision ? 'Update decision' : 'Save decision'}</button>
              {decisionMessage && <div className="transcript-action__message" role="status">{decisionMessage}</div>}
            </form>
          </aside>
        </div>
      </main>

      <footer className="footer">AI-generated interview support · Evidence must be reviewed by a human recruiter.</footer>
    </div>
  )
}
