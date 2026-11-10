import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { db } from '../firebase.js'
import { generateInterviewPlan, interviewErrorMessage } from '../services/interviews.js'

const QUESTION_TYPES = [
  { id: 'role_skill', label: 'Role skills' },
  { id: 'situational', label: 'Situational' },
  { id: 'behavioural', label: 'Behavioural' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'values', label: 'Values' },
]

const QUESTION_COUNT_BY_LENGTH = { 30: 8, 45: 11, 60: 15 }
const LEGACY_QUESTION_TYPES = {
  role_skills: 'role_skill',
  behavioral: 'behavioural',
  work_approach: 'values',
}

function normalizeQuestionTypes(types) {
  return [...new Set(types.map(type => LEGACY_QUESTION_TYPES[type] || type))]
    .filter(type => QUESTION_TYPES.some(item => item.id === type))
}

function planTypeLabel(type) {
  return QUESTION_TYPES.find(item => item.id === type)?.label || type
}

export default function InterviewPlanPage() {
  const { interviewId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [interview, setInterview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [lengthMinutes, setLengthMinutes] = useState(45)
  const [seniority, setSeniority] = useState('Mid')
  const [questionTypes, setQuestionTypes] = useState(['role_skill', 'situational', 'behavioural'])
  const [topics, setTopics] = useState([])
  const [topicInput, setTopicInput] = useState('')
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [formReady, setFormReady] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [actionError, setActionError] = useState('')
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

        const nextInterview = { id: snapshot.id, ...snapshot.data() }
        setInterview(nextInterview)
        if (!formReady) {
          const settings = nextInterview.settings || {}
          setLengthMinutes(Number(settings.lengthMinutes) || 45)
          setSeniority(settings.seniority || 'Mid')
          setQuestionTypes(Array.isArray(settings.questionTypes) && settings.questionTypes.length
            ? normalizeQuestionTypes(settings.questionTypes)
            : ['role_skill', 'situational', 'behavioural'])
          setTopics(Array.isArray(settings.topics) ? settings.topics : [])
          setAdditionalInstructions(settings.additionalInstructions || '')
          setFormReady(true)
        }
        setLoadError('')
        setLoading(false)
      },
      error => {
        console.error('Could not load interview plan:', error)
        setLoadError('Could not load this interview plan. Please try again.')
        setLoading(false)
      },
    )
  }, [formReady, interviewId, user?.uid])

  const selectedTypeLabels = useMemo(
    () => questionTypes.map(planTypeLabel).join(', '),
    [questionTypes],
  )

  const toggleQuestionType = type => {
    setQuestionTypes(current => current.includes(type)
      ? current.filter(item => item !== type)
      : [...current, type])
    setActionError('')
  }

  const addTopic = () => {
    const topic = topicInput.trim().replace(/\s+/g, ' ')
    if (!topic) return
    if (topics.some(item => item.toLowerCase() === topic.toLowerCase())) {
      setActionError('That topic is already included.')
      return
    }
    if (topics.length >= QUESTION_COUNT_BY_LENGTH[lengthMinutes]) {
      setActionError(`A ${lengthMinutes}-minute plan supports up to ${QUESTION_COUNT_BY_LENGTH[lengthMinutes]} topics so each topic gets a question.`)
      return
    }
    setTopics(current => [...current, topic])
    setTopicInput('')
    setActionError('')
  }

  const submit = async event => {
    event.preventDefault()
    if (!questionTypes.length) return setActionError('Select at least one question type.')
    if (!topics.length) return setActionError('Add at least one interview topic.')
    if (topics.length > QUESTION_COUNT_BY_LENGTH[lengthMinutes]) {
      return setActionError(`Remove ${topics.length - QUESTION_COUNT_BY_LENGTH[lengthMinutes]} topic${topics.length - QUESTION_COUNT_BY_LENGTH[lengthMinutes] === 1 ? '' : 's'} so every topic can receive a question.`)
    }
    if (interview?.plan && !window.confirm('Generate a new version? The current draft plan will be replaced.')) return

    setGenerating(true)
    setActionError('')
    try {
      const result = await generateInterviewPlan(interviewId, {
        lengthMinutes,
        seniority,
        questionTypes,
        topics,
        additionalInstructions,
      })
      console.info('Interview plan generated:', {
        interviewId: result.interviewId,
        status: result.status,
        planVersion: result.planVersion,
        promptVersion: result.promptVersion,
        questionCount: result.plan?.totalQuestions
          || result.plan?.sections?.reduce((total, section) => total + (section.questions?.length || 0), 0)
          || 0,
      })
      navigate(`/interviews/${interviewId}/review`)
    } catch (error) {
      console.error('Could not generate interview plan:', {
        code: error?.code || 'unknown',
        message: error?.message || 'No error message returned',
        details: error?.details || null,
      })
      setActionError(interviewErrorMessage(error, 'Could not generate the interview plan. Please try again.'))
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return <div className="report-page"><main className="screening-report glass glass--strong report-state">Loading interview plan…</main></div>
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

      <main className="page interview-plan-page">
        <Link className="interview-plan__back" to="/interviews">← Interviews</Link>
        <header className="interview-plan__head">
          <span className="eyebrow">Candidate interview plan</span>
          <h1>{interview.plan ? 'Update interview plan' : 'Create interview plan'}</h1>
          <p>The candidate and job are locked from screening. Confirm the focus, then generate a recruiter-reviewed question plan.</p>
        </header>

        <div className="interview-plan__steps" aria-label="Step 1 of 3">
          <span className="is-active"><b>1</b> Inputs</span>
          <span><b>2</b> Generate with Gemini</span>
          <span><b>3</b> Review & approve</span>
        </div>

        <form className="interview-plan__layout" onSubmit={submit}>
          <div className="interview-plan__main">
            <section className="plan-card glass glass--lg">
              <div className="plan-card__head"><div><span>1</span><h2>Candidate & job</h2></div><small>Locked from screening</small></div>
              <div className="plan-identity">
                <article><span>Candidate</span><b>{interview.candidateName}</b><small>{interview.role}</small></article>
                <article><span>Job description</span><b>{interview.jobTitle}</b><small>{interview.screeningScore}% screening match</small></article>
              </div>
            </section>

            <section className="plan-card glass glass--lg">
              <div className="plan-card__head"><div><span>2</span><h2>Interview settings</h2></div><small>You can adjust these suggestions</small></div>

              <div className="plan-setting-grid">
                <fieldset><legend>Length</legend><div className="segmented-control">{[30, 45, 60].map(value => <button className={lengthMinutes === value ? 'is-selected' : ''} type="button" key={value} onClick={() => { setLengthMinutes(value); setActionError('') }}>{value} min</button>)}</div><small>{QUESTION_COUNT_BY_LENGTH[lengthMinutes]} structured questions</small></fieldset>
                <fieldset><legend>Seniority</legend><div className="segmented-control">{['Junior', 'Mid', 'Senior'].map(value => <button className={seniority === value ? 'is-selected' : ''} type="button" key={value} onClick={() => setSeniority(value)}>{value}</button>)}</div><small>Suggested from the job title; confirm or change it.</small></fieldset>
              </div>

              <fieldset className="plan-question-types"><legend>Question types</legend><div>{QUESTION_TYPES.map(type => <label className={questionTypes.includes(type.id) ? 'is-selected' : ''} key={type.id}><input type="checkbox" checked={questionTypes.includes(type.id)} onChange={() => toggleQuestionType(type.id)} />{type.label}</label>)}</div></fieldset>

              <fieldset className="plan-topics"><legend>Topics to cover <small>Suggested from the job, resume and screening evidence</small></legend><div className="plan-topic-list">{topics.map(topic => <span key={topic}>{topic}<button type="button" aria-label={`Remove ${topic}`} onClick={() => setTopics(current => current.filter(item => item !== topic))}>×</button></span>)}</div><div className="plan-topic-add"><input value={topicInput} onChange={event => setTopicInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTopic() } }} placeholder="Add a job-related topic" maxLength="180" /><button className="btn" type="button" onClick={addTopic}>Add topic</button></div></fieldset>

              <label className="plan-instructions"><span>Extra instructions for Gemini <small>(optional)</small></span><textarea value={additionalInstructions} onChange={event => setAdditionalInstructions(event.target.value)} maxLength="1500" placeholder="For example: probe the candidate’s hands-on ownership of the migration project." /></label>
            </section>
          </div>

          <aside className="plan-receipt glass glass--lg">
            <span className="eyebrow">Gemini will receive</span>
            <dl><div><dt>Resume</dt><dd>{interview.candidateName}</dd></div><div><dt>Job description</dt><dd>{interview.jobTitle}</dd></div><div><dt>Topics</dt><dd>{topics.length} selected</dd></div><div><dt>Length</dt><dd>{lengthMinutes} min</dd></div><div><dt>Seniority</dt><dd>{seniority}</dd></div></dl>
            <p>Questions use the selected job-related topics and types: {selectedTypeLabels || 'none selected'}.</p>
            <button className="btn btn--primary" type="submit" disabled={generating}>{generating ? 'Generating plan…' : interview.plan ? 'Generate new version' : 'Generate plan with Gemini'}</button>
            {interview.plan && <Link className="btn plan-receipt__review" to={`/interviews/${interviewId}/review`}>Review current plan</Link>}
            <small>Nothing is sent to the candidate. You review the plan before it is approved or used.</small>
            {actionError && <div className="plan-error" role="alert">{actionError}</div>}
          </aside>
        </form>
      </main>
      <footer className="footer">Who’s Next supports structured interviews. Hiring decisions stay with you.</footer>
    </div>
  )
}
