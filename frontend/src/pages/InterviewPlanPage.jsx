import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { INTERVIEW_STATUS, interviewStatusDetails, interviewStatusKey } from '../constants/statuses.js'
import { generateInterviewPlan, interviewErrorMessage, subscribeToInterview } from '../services/interviews.js'

const QUESTION_TYPES = [
  { id: 'role_skill', label: 'Role skills' },
  { id: 'situational', label: 'Situational' },
  { id: 'behavioural', label: 'Behavioural' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'values', label: 'Values' },
]
const QUESTION_COUNT_BY_LENGTH = { 30: 8, 45: 11, 60: 15 }
const LEGACY_QUESTION_TYPES = { role_skills: 'role_skill', behavioral: 'behavioural', work_approach: 'values' }
const LOCKED_STATUSES = new Set([INTERVIEW_STATUS.TRANSCRIPT_SUBMITTED, INTERVIEW_STATUS.REPORT_READY, INTERVIEW_STATUS.DECIDED])
const GENERATION_STAGES = {
  preparing: 'Preparing the job description and resume',
  reading: 'Reading the documents',
  generating: 'Gemini is writing the questions',
}

function normalizeQuestionTypes(types) {
  return [...new Set(types.map(type => LEGACY_QUESTION_TYPES[type] || type))].filter(type => QUESTION_TYPES.some(item => item.id === type))
}

function StateCard({ title, children }) {
  return (
    <div className="report-page">
      <main className="screening-report glass glass--strong report-state">
        {title && <h1>{title}</h1>}
        {children}
      </main>
    </div>
  )
}

export default function InterviewPlanPage() {
  const { interviewId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [interview, setInterview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [settings, setSettings] = useState(null)
  const [topicInput, setTopicInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [actionError, setActionError] = useState('')

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
        console.error('Could not load interview:', error)
        setLoadError('Could not load this interview. Please try again.')
        setLoading(false)
      },
    })
  }, [interviewId, user?.uid])

  // Initialise the form once from the saved settings; later snapshots must not overwrite edits.
  useEffect(() => {
    if (!interview || settings) return
    const saved = interview.settings || {}
    setSettings({
      lengthMinutes: Number(saved.lengthMinutes) || 45,
      seniority: saved.seniority || 'Mid',
      questionTypes: Array.isArray(saved.questionTypes) && saved.questionTypes.length
        ? normalizeQuestionTypes(saved.questionTypes)
        : ['role_skill', 'situational', 'behavioural'],
      topics: Array.isArray(saved.topics) ? saved.topics : [],
      additionalInstructions: saved.additionalInstructions || '',
    })
  }, [interview, settings])

  const update = changes => {
    setSettings(current => ({ ...current, ...changes }))
    setActionError('')
  }

  const maxTopics = settings ? QUESTION_COUNT_BY_LENGTH[settings.lengthMinutes] : 0
  const selectedTypeLabels = useMemo(
    () => (settings?.questionTypes || []).map(type => QUESTION_TYPES.find(item => item.id === type)?.label || type).join(', '),
    [settings?.questionTypes],
  )

  if (loading || (!loadError && !settings)) return <StateCard>Loading interview…</StateCard>
  if (loadError || !interview) {
    return (
      <StateCard title="Interview unavailable">
        <p>{loadError}</p>
        <Link className="btn btn--primary" to="/interviews">Back to interviews</Link>
      </StateCard>
    )
  }

  const status = interviewStatusKey(interview.status)
  const locked = LOCKED_STATUSES.has(status)
  const approved = status === INTERVIEW_STATUS.PLAN_APPROVED
  const serverGeneration = interview.planGeneration
  const busy = generating || serverGeneration?.status === 'running'

  const toggleQuestionType = type => update({
    questionTypes: settings.questionTypes.includes(type)
      ? settings.questionTypes.filter(item => item !== type)
      : [...settings.questionTypes, type],
  })

  const addTopic = () => {
    const topic = topicInput.trim().replace(/\s+/g, ' ')
    if (!topic) return
    if (settings.topics.some(item => item.toLowerCase() === topic.toLowerCase())) return setActionError('That topic is already included.')
    if (settings.topics.length >= maxTopics) {
      return setActionError(`A ${settings.lengthMinutes}-minute plan supports up to ${maxTopics} topics so each topic gets a question.`)
    }
    update({ topics: [...settings.topics, topic] })
    setTopicInput('')
  }

  const submit = async event => {
    event.preventDefault()
    if (!settings.questionTypes.length) return setActionError('Select at least one question type.')
    if (!settings.topics.length) return setActionError('Add at least one interview topic.')
    if (settings.topics.length > maxTopics) {
      const extra = settings.topics.length - maxTopics
      return setActionError(`Remove ${extra} topic${extra === 1 ? '' : 's'} so every topic can receive a question.`)
    }
    if (approved && !window.confirm('This plan is already approved. Generate a new version and replace the approved plan?')) return
    if (!approved && interview.plan && !window.confirm('Generate a new version? The current draft plan will be replaced.')) return

    setGenerating(true)
    setActionError('')
    try {
      await generateInterviewPlan(interviewId, settings, approved)
      navigate(`/interviews/${interviewId}/review`)
    } catch (error) {
      console.error('Could not generate the plan:', { code: error?.code, message: error?.message })
      setActionError(interviewErrorMessage(error, 'Could not generate the interview plan. Please try again.'))
    } finally {
      setGenerating(false)
    }
  }

  const nextStep = interviewStatusDetails(interview)

  return (
    <AppLayout mainClassName="page interview-plan-page" footer="Who’s Next supports structured interviews. Hiring decisions stay with you.">
      <Link className="interview-plan__back" to="/interviews">← Interviews</Link>
      <header className="interview-plan__head">
        <span className="eyebrow">Candidate interview plan</span>
        <h1>{interview.plan ? 'Update interview plan' : 'Create interview plan'}</h1>
        <p>The candidate and job are locked from screening. Confirm the focus, then generate a question plan you can review and edit.</p>
      </header>

      {locked && (
        <div className="workflow-notice" role="note">
          <b>This plan can no longer change.</b>
          <span>A transcript has already been added for this interview.</span>
          <Link className="btn btn--small" to={nextStep.to}>{nextStep.action}</Link>
        </div>
      )}

      <div className="interview-plan__steps" aria-label="Step 1 of 3">
        <span className="is-active"><b>1</b> Inputs</span>
        <span><b>2</b> Generate with Gemini</span>
        <span><b>3</b> Review & approve</span>
      </div>

      <form className="interview-plan__layout" onSubmit={submit}>
        <fieldset className="interview-plan__main" disabled={locked || busy}>
          <section className="plan-card glass glass--lg">
            <div className="plan-card__head"><div><span>1</span><h2>Candidate & job</h2></div><small>Locked from screening</small></div>
            <div className="plan-identity">
              <article><span>Candidate</span><b>{interview.candidateName}</b><small>{interview.role}</small></article>
              <article><span>Job description</span><b>{interview.jobTitle}</b><small>{interview.screeningScore}% screening match{interview.round > 1 ? ` · Round ${interview.round}` : ''}</small></article>
            </div>
          </section>

          <section className="plan-card glass glass--lg">
            <div className="plan-card__head"><div><span>2</span><h2>Interview settings</h2></div><small>You can adjust these suggestions</small></div>

            <div className="plan-setting-grid">
              <fieldset>
                <legend>Length</legend>
                <div className="segmented-control">
                  {[30, 45, 60].map(value => (
                    <button className={settings.lengthMinutes === value ? 'is-selected' : ''} type="button" key={value} onClick={() => update({ lengthMinutes: value })}>{value} min</button>
                  ))}
                </div>
                <small>{maxTopics} structured questions</small>
              </fieldset>
              <fieldset>
                <legend>Seniority</legend>
                <div className="segmented-control">
                  {['Junior', 'Mid', 'Senior'].map(value => (
                    <button className={settings.seniority === value ? 'is-selected' : ''} type="button" key={value} onClick={() => update({ seniority: value })}>{value}</button>
                  ))}
                </div>
                <small>Suggested from the job title; confirm or change it.</small>
              </fieldset>
            </div>

            <fieldset className="plan-question-types">
              <legend>Question types</legend>
              <div>
                {QUESTION_TYPES.map(type => (
                  <label className={settings.questionTypes.includes(type.id) ? 'is-selected' : ''} key={type.id}>
                    <input type="checkbox" checked={settings.questionTypes.includes(type.id)} onChange={() => toggleQuestionType(type.id)} />
                    {type.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="plan-topics">
              <legend>Topics to cover <small>Suggested from the job, resume and screening evidence · {settings.topics.length}/{maxTopics}</small></legend>
              <div className="plan-topic-list">
                {settings.topics.map(topic => (
                  <span key={topic}>
                    {topic}
                    <button type="button" aria-label={`Remove ${topic}`} onClick={() => update({ topics: settings.topics.filter(item => item !== topic) })}>×</button>
                  </span>
                ))}
              </div>
              <div className="plan-topic-add">
                <input
                  value={topicInput}
                  onChange={event => setTopicInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addTopic()
                    }
                  }}
                  placeholder="Add a job-related topic"
                  maxLength="180"
                  aria-label="New topic"
                />
                <button className="btn" type="button" onClick={addTopic}>Add topic</button>
              </div>
            </fieldset>

            <label className="plan-instructions">
              <span>Extra instructions for Gemini <small>(optional)</small></span>
              <textarea
                value={settings.additionalInstructions}
                onChange={event => update({ additionalInstructions: event.target.value })}
                maxLength="1500"
                placeholder="For example: probe the candidate’s hands-on ownership of the migration project."
              />
            </label>
          </section>
        </fieldset>

        <aside className="plan-receipt glass glass--lg">
          <span className="eyebrow">Gemini will receive</span>
          <dl>
            <div><dt>Resume</dt><dd>{interview.candidateName}</dd></div>
            <div><dt>Job description</dt><dd>{interview.jobTitle}</dd></div>
            <div><dt>Screening findings</dt><dd>Matched and missing skills</dd></div>
            <div><dt>Topics</dt><dd>{settings.topics.length} selected</dd></div>
            <div><dt>Length</dt><dd>{settings.lengthMinutes} min</dd></div>
            <div><dt>Seniority</dt><dd>{settings.seniority}</dd></div>
          </dl>
          <p>Questions use the selected job-related topics and types: {selectedTypeLabels || 'none selected'}.</p>
          <button className="btn btn--primary" type="submit" disabled={busy || locked}>
            {busy ? 'Generating plan…' : interview.plan ? 'Generate new version' : 'Generate plan with Gemini'}
          </button>
          {busy && (
            <small className="plan-receipt__progress" role="status">
              {GENERATION_STAGES[serverGeneration?.stage] || 'Starting…'} This usually takes under a minute.
            </small>
          )}
          {!busy && serverGeneration?.status === 'failed' && !actionError && (
            <div className="plan-error" role="alert">The last attempt failed: {serverGeneration.message}</div>
          )}
          {interview.plan && <Link className="btn plan-receipt__review" to={`/interviews/${interviewId}/review`}>Review current plan</Link>}
          <small>Nothing is sent to the candidate. You review and can edit the plan before approving it.</small>
          {actionError && <div className="plan-error" role="alert">{actionError}</div>}
        </aside>
      </form>
    </AppLayout>
  )
}
