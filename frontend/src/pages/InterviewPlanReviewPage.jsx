import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { INTERVIEW_STATUS, interviewStatusDetails, interviewStatusKey } from '../constants/statuses.js'
import {
  approveInterviewPlan,
  interviewErrorMessage,
  subscribeToInterview,
  updateInterviewPlan,
} from '../services/interviews.js'

const TYPE_LABELS = {
  role_skill: 'Role skill',
  role_skills: 'Role skills',
  situational: 'Situational',
  behavioural: 'Behavioural',
  behavioral: 'Behavioural',
  knowledge: 'Knowledge',
  values: 'Values',
  work_approach: 'Work approach',
}

/** Supports structured plans (sections) and the oldest flat plan format. */
function normalizePlan(plan, configuredTopics) {
  if (!plan) return { sections: [], questions: [], coverage: [], resumePoints: [], plannedMinutes: 0, editable: false }

  if (Array.isArray(plan.sections)) {
    const sections = plan.sections.map((section, sectionIndex) => ({
      name: section.name || `Section ${sectionIndex + 1}`,
      questions: (section.questions || []).map((question, index) => ({
        id: question.id || `q${question.number || index + 1}`,
        number: question.number || index + 1,
        topic: question.topic,
        type: question.type,
        minutes: Number(question.minutes) || 0,
        question: question.question,
        goodAnswerCovers: question.goodAnswerCovers || question.good_answer_covers || [],
        followUp: question.followUp || question.follow_up || '',
        watchOutFor: question.watchOutFor || question.watch_out_for || '',
      })),
    }))
    const questions = sections.flatMap(section => section.questions)
    const coverage = Array.isArray(plan.topicCoverage)
      ? plan.topicCoverage.map(item => ({ topic: item.topic, count: item.questionCount || 0 }))
      : configuredTopics.map(topic => ({ topic, count: questions.filter(question => question.topic === topic).length }))
    return {
      sections,
      questions,
      coverage,
      resumePoints: plan.resumePointsToProbe || [],
      plannedMinutes: plan.totalMinutes || questions.reduce((total, question) => total + question.minutes, 0),
      editable: true,
    }
  }

  const questions = (plan.questions || []).map((question, index) => ({
    ...question,
    id: question.id || `q${index + 1}`,
    number: question.order || index + 1,
    minutes: question.estimatedMinutes,
    goodAnswerCovers: question.goodAnswerIncludes || [],
    watchOutFor: '',
  }))
  return {
    sections: questions.length ? [{ name: 'Generated questions', questions }] : [],
    questions,
    coverage: configuredTopics.map(topic => ({ topic, count: questions.filter(question => question.topic === topic).length })),
    resumePoints: [],
    plannedMinutes: plan.totalMinutes || 0,
    editable: false,
  }
}

function QuestionEditor({ question, index, total, onChange, onMove, onRemove }) {
  return (
    <article className="glass glass--lg plan-review-question plan-edit-question">
      <span className="generated-plan__number">{index + 1}</span>
      <div>
        <div className="generated-plan__meta">
          <span>{question.topic}</span>
          <span>{TYPE_LABELS[question.type] || question.type}</span>
          <label className="plan-edit-minutes">
            <input type="number" min="1" max="10" value={question.minutes} onChange={event => onChange({ minutes: Number(event.target.value) })} aria-label="Minutes" />
            min
          </label>
        </div>
        <label className="plan-edit-field">
          <span>Question</span>
          <textarea rows="2" value={question.question} maxLength={800} onChange={event => onChange({ question: event.target.value })} />
        </label>
        <label className="plan-edit-field">
          <span>A good answer covers (one point per line)</span>
          <textarea rows="3" value={question.goodAnswerText} maxLength={2000} onChange={event => onChange({ goodAnswerText: event.target.value })} />
        </label>
        <label className="plan-edit-field">
          <span>Follow-up</span>
          <input value={question.followUp} maxLength={500} onChange={event => onChange({ followUp: event.target.value })} />
        </label>
        <label className="plan-edit-field">
          <span>Watch out for</span>
          <input value={question.watchOutFor} maxLength={400} onChange={event => onChange({ watchOutFor: event.target.value })} />
        </label>
        <div className="plan-edit-actions">
          <button type="button" className="btn btn--small" onClick={() => onMove(-1)} disabled={index === 0}>↑ Up</button>
          <button type="button" className="btn btn--small" onClick={() => onMove(1)} disabled={index === total - 1}>↓ Down</button>
          <button type="button" className="btn btn--small btn--danger" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </article>
  )
}

export default function InterviewPlanReviewPage() {
  const { interviewId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [interview, setInterview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [draft, setDraft] = useState(null) // editable copy of the sections while editing

  useEffect(() => {
    if (!user?.uid || !interviewId) return undefined
    return subscribeToInterview(user.uid, interviewId, {
      onChange: next => {
        setInterview(next)
        setLoadError('')
        setLoading(false)
      },
      onMissing: () => {
        setLoadError('This interview could not be found.')
        setLoading(false)
      },
      onError: error => {
        console.error('Could not load the plan:', error)
        setLoadError('Could not load this interview plan. Please try again.')
        setLoading(false)
      },
    })
  }, [interviewId, user?.uid])

  const planModel = useMemo(
    () => normalizePlan(interview?.plan, interview?.settings?.topics || []),
    [interview?.plan, interview?.settings?.topics],
  )

  if (loading || loadError || !interview) {
    return (
      <div className="report-page">
        <main className="screening-report glass glass--strong report-state">
          {loading ? 'Loading plan…' : (
            <>
              <h1>Plan unavailable</h1>
              <p>{loadError}</p>
              <Link className="btn btn--primary" to="/interviews">Back to interviews</Link>
            </>
          )}
        </main>
      </div>
    )
  }

  if (!interview.plan || planModel.questions.length === 0) {
    return (
      <div className="report-page">
        <main className="screening-report glass glass--strong report-state">
          <h1>No plan yet</h1>
          <p>Confirm the interview settings and generate the questions first.</p>
          <Link className="btn btn--primary" to={`/interviews/${interviewId}/plan`}>Create interview plan</Link>
        </main>
      </div>
    )
  }

  const status = interviewStatusKey(interview.status)
  const isDraft = status === INTERVIEW_STATUS.PLAN_READY
  const isApproved = status === INTERVIEW_STATUS.PLAN_APPROVED
  const isLocked = !isDraft && !isApproved
  const { sections, questions, coverage, resumePoints, plannedMinutes } = planModel
  const coveredTopics = coverage.filter(item => item.count > 0).length
  const lengthMinutes = interview.settings?.lengthMinutes || plannedMinutes
  const nextStep = interviewStatusDetails(interview)

  const startEditing = () => {
    if (isApproved && !window.confirm('This plan is approved. Editing creates a new version that must be approved again. Continue?')) return
    setActionError('')
    setDraft(sections.map(section => ({
      name: section.name,
      questions: section.questions.map(question => ({ ...question, goodAnswerText: question.goodAnswerCovers.join('\n') })),
    })))
  }

  const changeQuestion = (sectionIndex, questionIndex, changes) => setDraft(current => current.map((section, s) => (
    s !== sectionIndex ? section : {
      ...section,
      questions: section.questions.map((question, q) => (q === questionIndex ? { ...question, ...changes } : question)),
    }
  )))

  const moveQuestion = (sectionIndex, questionIndex, offset) => setDraft(current => current.map((section, s) => {
    if (s !== sectionIndex) return section
    const list = [...section.questions]
    const [item] = list.splice(questionIndex, 1)
    list.splice(questionIndex + offset, 0, item)
    return { ...section, questions: list }
  }))

  const removeQuestion = (sectionIndex, questionIndex) => setDraft(current => current.map((section, s) => (
    s !== sectionIndex ? section : { ...section, questions: section.questions.filter((_, q) => q !== questionIndex) }
  )))

  const saveEdits = async () => {
    const payload = draft
      .map(section => ({
        name: section.name,
        questions: section.questions.map(question => ({
          id: question.id,
          question: question.question,
          goodAnswerCovers: question.goodAnswerText.split('\n').map(line => line.trim()).filter(Boolean),
          followUp: question.followUp,
          watchOutFor: question.watchOutFor,
          minutes: question.minutes,
        })),
      }))
      .filter(section => section.questions.length)

    setBusy(true)
    setActionError('')
    try {
      const result = await updateInterviewPlan(interviewId, interview.planVersion, payload, isApproved)
      setDraft(null)
      if (!result.allTopicsCovered) setActionError('Saved. Note: some selected topics no longer have a question.')
    } catch (error) {
      setActionError(interviewErrorMessage(error, 'Your edits could not be saved. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    setBusy(true)
    setActionError('')
    try {
      await approveInterviewPlan(interviewId, interview.planVersion)
      navigate(`/interviews/${interviewId}/transcript`)
    } catch (error) {
      setActionError(interviewErrorMessage(error, 'Could not approve this plan. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = isDraft ? 'Draft, not approved' : isApproved ? `Approved · version ${interview.planVersion}` : `Approved · locked (${nextStep.label.toLowerCase()})`
  const editing = Boolean(draft)

  return (
    <AppLayout mainClassName="page plan-review-page" footer="Who’s Next supports structured interviews. Hiring decisions stay with you.">
      <Link className="interview-plan__back" to="/interviews">← Interviews</Link>

      <header className="plan-review__header">
        <div>
          <span className="eyebrow">Interviews / {interview.candidateName} / Plan</span>
          <h1>Interview plan · {interview.candidateName}</h1>
          <div className={`plan-review__status${isDraft ? '' : ' plan-review__status--approved'}`}><span className="dot" />{statusLabel}</div>
          <p>{interview.jobTitle} · {lengthMinutes} min · {questions.length} questions · Generated with {interview.plan.model || 'Gemini'}{interview.plan.edited ? ' · edited' : ''}</p>
        </div>
        <div className="plan-review__header-actions">
          {!isLocked && !editing && planModel.editable && <button type="button" className="btn" onClick={startEditing}>Edit questions</button>}
          {!isLocked && !editing && <Link className="btn" to={`/interviews/${interviewId}/plan`}>Regenerate</Link>}
          {isLocked && <Link className="btn btn--primary" to={nextStep.to}>{nextStep.action}</Link>}
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
            <div className="plan-coverage__time"><span>Planned time</span><b>{plannedMinutes} of {lengthMinutes} min</b></div>
          </section>

          <section className="glass glass--lg plan-review__summary">
            <span className="eyebrow">Plan summary</span>
            <p>Built from the job description, the candidate’s resume, the screening findings and your interview settings.</p>
            <dl>
              <div><dt>Version</dt><dd>{interview.planVersion || 1}</dd></div>
              <div><dt>Model</dt><dd>{interview.plan.model || 'Gemini'}</dd></div>
              <div><dt>Status</dt><dd>{isDraft ? 'Draft' : 'Approved'}</dd></div>
            </dl>
          </section>

          {resumePoints.length > 0 && (
            <section className="glass glass--lg plan-review__probes">
              <span className="eyebrow">Resume points to probe</span>
              <div>
                {resumePoints.map((item, index) => (
                  <article key={`${item.point}-${index}`}>
                    <p>{item.point}</p>
                    {(item.questionNumbers || []).length > 0 && <small>Questions {item.questionNumbers.join(', ')}</small>}
                  </article>
                ))}
              </div>
            </section>
          )}
        </aside>

        <section className="plan-review__questions">
          <div className="plan-review__questions-head">
            <div><span className="eyebrow">{editing ? 'Editing' : 'Review & approve'}</span><h2>{editing ? 'Edit questions' : 'Questions'}</h2></div>
            <span>{questions.length} questions · {plannedMinutes} min</span>
          </div>

          {editing ? draft.map((section, sectionIndex) => (
            <section className="plan-review-section" key={`edit-${sectionIndex}`}>
              <div className="plan-review-section__head">
                <input
                  className="plan-edit-section-name"
                  value={section.name}
                  maxLength={180}
                  aria-label="Section name"
                  onChange={event => setDraft(current => current.map((item, s) => (s === sectionIndex ? { ...item, name: event.target.value } : item)))}
                />
                <span>{section.questions.length} {section.questions.length === 1 ? 'question' : 'questions'}</span>
              </div>
              {section.questions.map((question, questionIndex) => (
                <QuestionEditor
                  key={question.id}
                  question={question}
                  index={questionIndex}
                  total={section.questions.length}
                  onChange={changes => changeQuestion(sectionIndex, questionIndex, changes)}
                  onMove={offset => moveQuestion(sectionIndex, questionIndex, offset)}
                  onRemove={() => removeQuestion(sectionIndex, questionIndex)}
                />
              ))}
            </section>
          )) : sections.map(section => (
            <section className="plan-review-section" key={section.name}>
              <div className="plan-review-section__head">
                <h3>{section.name}</h3>
                <span>{section.questions.length} {section.questions.length === 1 ? 'question' : 'questions'} · {section.questions.reduce((total, question) => total + question.minutes, 0)} min</span>
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
                    <details>
                      <summary>Show answer guide</summary>
                      <div className="plan-answer-guide">
                        <div><b>A good answer covers</b><ul>{question.goodAnswerCovers.map(item => <li key={item}>{item}</li>)}</ul></div>
                        <div className="plan-answer-guide__notes">
                          {question.followUp && <div><b>Follow-up</b><p>{question.followUp}</p></div>}
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
            {editing ? (
              <>
                <span>Saving creates a new plan version{isApproved ? ' that must be approved again' : ''}.</span>
                <div className="plan-edit-actions">
                  <button className="btn" type="button" onClick={() => setDraft(null)} disabled={busy}>Cancel</button>
                  <button className="btn btn--primary" type="button" onClick={saveEdits} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
                </div>
              </>
            ) : isDraft ? (
              <>
                <span>Approval locks this plan version and opens the transcript step.</span>
                <button className="btn btn--primary" type="button" onClick={approve} disabled={busy || !interview.planVersion}>{busy ? 'Approving…' : 'Approve plan'}</button>
              </>
            ) : isApproved ? (
              <>
                <span>Run the interview using this plan, then add the transcript.</span>
                <Link className="btn btn--primary" to={`/interviews/${interviewId}/transcript`}>Continue to transcript</Link>
              </>
            ) : (
              <>
                <span>This plan was used for the interview and can no longer change.</span>
                <Link className="btn btn--primary" to={nextStep.to}>{nextStep.action}</Link>
              </>
            )}
          </div>
          {actionError && <div className="plan-error" role="alert">{actionError}</div>}
        </section>
      </div>
    </AppLayout>
  )
}
