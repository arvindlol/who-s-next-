import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { db } from '../firebase.js'
import { approveInterviewPlan, interviewErrorMessage } from '../services/interviews.js'

const TYPE_LABELS = {
  role_skill: 'Role skill',
  role_skills: 'Role skills',
  situational: 'Situational',
  behavioural: 'Behavioural',
  behavioral: 'Behavioral',
  knowledge: 'Knowledge',
  values: 'Values',
  work_approach: 'Work approach',
}

function topicCounts(questions, configuredTopics) {
  const counts = new Map()
  configuredTopics.forEach(topic => counts.set(topic, 0))

  questions.forEach(question => {
    const topic = question.topic || 'Other'
    const matchingTopic = configuredTopics.find(item => (
      item.toLowerCase() === topic.toLowerCase()
      || topic.toLowerCase().includes(item.toLowerCase())
      || item.toLowerCase().includes(topic.toLowerCase())
    ))
    const key = matchingTopic || topic
    counts.set(key, (counts.get(key) || 0) + 1)
  })

  return [...counts.entries()].map(([topic, count]) => ({ topic, count }))
}

function normalizePlan(plan, configuredTopics) {
  if (!plan) return { sections: [], questions: [], coverage: [], resumePoints: [], plannedMinutes: 0 }

  if (Array.isArray(plan.sections)) {
    const sections = plan.sections.map((section, sectionIndex) => ({
      name: section.name || `Section ${sectionIndex + 1}`,
      questions: (section.questions || []).map((question, questionIndex) => ({
        id: question.id || `q${question.number || questionIndex + 1}`,
        number: question.number || questionIndex + 1,
        topic: question.topic,
        type: question.type,
        minutes: question.minutes,
        question: question.question,
        goodAnswerCovers: question.goodAnswerCovers || question.good_answer_covers || [],
        followUp: question.followUp || question.follow_up,
        watchOutFor: question.watchOutFor || question.watch_out_for,
      })),
    }))
    const questions = sections.flatMap(section => section.questions)
    const coverage = Array.isArray(plan.topicCoverage)
      ? plan.topicCoverage.map(item => ({ topic: item.topic, count: item.questionCount || 0 }))
      : topicCounts(questions, configuredTopics)

    return {
      sections,
      questions,
      coverage,
      resumePoints: plan.resumePointsToProbe || [],
      plannedMinutes: plan.totalMinutes || questions.reduce((total, question) => total + Number(question.minutes || 0), 0),
      overview: '',
    }
  }

  const questions = (plan.questions || []).map((question, index) => ({
    ...question,
    number: question.order || index + 1,
    minutes: question.estimatedMinutes,
    goodAnswerCovers: question.goodAnswerIncludes || [],
    watchOutFor: '',
  }))
  return {
    sections: questions.length ? [{ name: 'Generated questions', questions }] : [],
    questions,
    coverage: topicCounts(questions, configuredTopics),
    resumePoints: [],
    plannedMinutes: plan.totalMinutes || questions.reduce((total, question) => total + Number(question.minutes || 0), 0),
    overview: plan.overview || '',
  }
}

export default function InterviewPlanReviewPage() {
  const { interviewId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [interview, setInterview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [approving, setApproving] = useState(false)
  const [approvalError, setApprovalError] = useState('')
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  useEffect(() => {
    if (!user?.uid || !interviewId) return undefined

    return onSnapshot(
      doc(db, 'interviews', interviewId),
      snapshot => {
        if (!snapshot.exists() || snapshot.get('ownerId') !== user.uid) {
          setLoadError('This interview plan could not be found.')
          setLoading(false)
          return
        }

        setInterview({ id: snapshot.id, ...snapshot.data() })
        setLoadError('')
        setLoading(false)
      },
      error => {
        console.error('Could not load generated interview plan:', error)
        setLoadError('Could not load this generated interview plan. Please try again.')
        setLoading(false)
      },
    )
  }, [interviewId, user?.uid])

  const planModel = useMemo(
    () => normalizePlan(interview?.plan, interview?.settings?.topics || []),
    [interview?.plan, interview?.settings?.topics],
  )
  const { sections, questions, coverage, resumePoints, plannedMinutes } = planModel
  const coveredTopics = coverage.filter(item => item.count > 0).length

  const approvePlan = async () => {
    if (approving || !interview?.planVersion) return

    setApproving(true)
    setApprovalError('')
    try {
      await approveInterviewPlan(interviewId, interview.planVersion)

      const transcriptContext = {
        candidateName: interview.candidateName,
        jobTitle: interview.jobTitle,
        planVersion: interview.planVersion || 1,
        totalQuestions: questions.length,
        totalMinutes: plannedMinutes,
      }

      try {
        window.sessionStorage.setItem(
          `whos-next:transcript-context:${interviewId}`,
          JSON.stringify(transcriptContext),
        )
      } catch (error) {
        console.warn('Could not keep transcript page context in this browser session:', error)
      }

      navigate(`/interviews/${interviewId}/transcript`, { state: { transcriptContext } })
    } catch (error) {
      console.error('Could not approve interview plan:', {
        code: error?.code || 'unknown',
        message: error?.message || 'No error message returned',
      })
      setApprovalError(interviewErrorMessage(error, 'Could not approve this interview plan. Please try again.'))
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return <div className="report-page"><main className="screening-report glass glass--strong report-state">Loading generated plan…</main></div>
  }

  if (loadError || !interview) {
    return (
      <div className="report-page">
        <main className="screening-report glass glass--strong report-state">
          <h1>Plan unavailable</h1><p>{loadError}</p><Link className="btn btn--primary" to="/interviews">Back to interviews</Link>
        </main>
      </div>
    )
  }

  if (!interview.plan || questions.length === 0) {
    return (
      <div className="report-page">
        <main className="screening-report glass glass--strong report-state">
          <h1>No generated plan yet</h1>
          <p>Confirm the interview settings and generate the questions before opening the review page.</p>
          <Link className="btn btn--primary" to={`/interviews/${interviewId}/plan`}>Create interview plan</Link>
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

      <main className="page plan-review-page">
        <Link className="interview-plan__back" to="/interviews">← Interviews</Link>

        <header className="plan-review__header">
          <div>
            <span className="eyebrow">Interviews / {interview.candidateName} / Plan</span>
            <h1>Interview plan · {interview.candidateName}</h1>
            <div className="plan-review__status"><span className="dot" />Draft, not approved</div>
            <p>{interview.jobTitle} · {interview.settings?.lengthMinutes || plannedMinutes} min · {questions.length} questions · Generated with {interview.plan.model || 'Gemini'}</p>
          </div>
          <div className="plan-review__header-actions">
            <Link className="btn" to={`/interviews/${interviewId}/plan`}>Regenerate</Link>
          </div>
        </header>

        <div className="plan-review__layout">
          <aside className="plan-review__sidebar">
            <section className="glass glass--lg plan-coverage">
              <span className="eyebrow">Topic coverage</span>
              <strong>{coveredTopics} of {coverage.length} selected topics covered</strong>
              <div className="plan-coverage__topics">
                {coverage.map(item => (
                  <div key={item.topic}>
                    <span>{item.topic}</span><b>{item.count} {item.count === 1 ? 'question' : 'questions'}</b>
                    <i style={{ '--coverage': `${Math.min(100, item.count * 50)}%` }} />
                  </div>
                ))}
              </div>
              <div className="plan-coverage__time"><span>Planned time</span><b>{plannedMinutes} of {interview.settings?.lengthMinutes || plannedMinutes} min</b></div>
            </section>

            <section className="glass glass--lg plan-review__summary">
              <span className="eyebrow">Plan summary</span>
              <p>{planModel.overview || 'Structured from the job description, candidate resume, and the interview settings selected by the recruiter.'}</p>
              <dl>
                <div><dt>Version</dt><dd>{interview.planVersion || 1}</dd></div>
                <div><dt>Model</dt><dd>{interview.plan.model || 'Gemini'}</dd></div>
                <div><dt>Status</dt><dd>Draft</dd></div>
              </dl>
            </section>

            {resumePoints.length > 0 && (
              <section className="glass glass--lg plan-review__probes">
                <span className="eyebrow">Resume points to probe</span>
                <div>
                  {resumePoints.map((item, index) => (
                    <article key={`${item.point}-${index}`}>
                      <p>{item.point}</p>
                      <small>Questions {(item.questionNumbers || item.question_numbers || []).join(', ')}</small>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </aside>

          <section className="plan-review__questions">
            <div className="plan-review__questions-head">
              <div><span className="eyebrow">Review & approve</span><h2>Generated questions</h2></div>
              <span>{questions.length} questions · {plannedMinutes} min</span>
            </div>

            {sections.map(section => (
              <section className="plan-review-section" key={section.name}>
                <div className="plan-review-section__head">
                  <h3>{section.name}</h3>
                  <span>{section.questions.length} {section.questions.length === 1 ? 'question' : 'questions'} · {section.questions.reduce((total, question) => total + Number(question.minutes || 0), 0)} min</span>
                </div>
                {section.questions.map(question => (
                  <article className="glass glass--lg plan-review-question" key={question.id}>
                    <span className="generated-plan__number">{question.number}</span>
                    <div>
                      <div className="generated-plan__meta">
                        <span>{question.topic}</span>
                        <span>{TYPE_LABELS[question.type] || question.type}</span>
                        <span>{question.minutes} min</span>
                      </div>
                      <h3>{question.question}</h3>
                      {question.rationale && <p>{question.rationale}</p>}
                      <details>
                        <summary>Show answer guide</summary>
                        <div className="plan-answer-guide">
                          <div><b>A good answer covers</b><ul>{question.goodAnswerCovers.map(item => <li key={item}>{item}</li>)}</ul></div>
                          <div className="plan-answer-guide__notes">
                            <div><b>Follow-up</b><p>{question.followUp}</p></div>
                            {question.watchOutFor && <div className="plan-answer-guide__watch"><b>Watch out for</b><p>{question.watchOutFor}</p></div>}
                          </div>
                        </div>
                      </details>
                    </div>
                  </article>
                ))}
              </section>
            ))}

            <div className="generated-plan__actions glass">
              <span>Approval locks this plan version and opens the transcript step.</span>
              <button className="btn btn--primary" type="button" onClick={approvePlan} disabled={approving || !interview.planVersion}>{approving ? 'Approving…' : 'Approve plan'}</button>
            </div>
            {approvalError && <div className="plan-error" role="alert">{approvalError}</div>}
          </section>
        </div>
      </main>

      <footer className="footer">Who’s Next supports structured interviews. Hiring decisions stay with you.</footer>
    </div>
  )
}
