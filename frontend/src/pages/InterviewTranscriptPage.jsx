import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import { db } from '../firebase.js'
import { generateInterviewReport, interviewErrorMessage, saveInterviewTranscript } from '../services/interviews.js'

function readSessionJson(key) {
  try {
    const value = window.sessionStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function readSessionText(key, fallback = '') {
  try {
    return window.sessionStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

export default function InterviewTranscriptPage() {
  const { interviewId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const contextKey = `whos-next:transcript-context:${interviewId}`
  const draftKey = `whos-next:transcript-draft:${interviewId}`
  const notesKey = `whos-next:transcript-notes:${interviewId}`
  const context = location.state?.transcriptContext || readSessionJson(contextKey) || {}
  const [interview, setInterview] = useState(null)
  const [transcript, setTranscript] = useState(() => readSessionText(draftKey))
  const [notes, setNotes] = useState(() => readSessionText(notesKey))
  const [removeContactDetails, setRemoveContactDetails] = useState(true)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const candidateName = interview?.candidateName || context.candidateName || 'Candidate'
  const jobTitle = interview?.jobTitle || context.jobTitle || 'Candidate interview'
  const approvedPlanVersion = interview?.approvedPlanVersion || context.planVersion
  const approvedPlan = interview?.plan
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0

  useEffect(() => {
    if (!user?.uid || !interviewId) return undefined
    return onSnapshot(doc(db, 'interviews', interviewId), snapshot => {
      if (snapshot.exists() && snapshot.get('ownerId') === user.uid) {
        setInterview({ id: snapshot.id, ...snapshot.data() })
      }
    })
  }, [interviewId, user?.uid])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(draftKey, transcript)
        window.sessionStorage.setItem(notesKey, notes)
      } catch (error) {
        console.warn('Could not save the local transcript draft:', error)
      }
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [draftKey, notes, notesKey, transcript])

  const clearTranscript = () => {
    if (transcript && !window.confirm('Clear the transcript from this browser draft?')) return
    setTranscript('')
    setMessage('')
  }

  const prepareFinalReport = async event => {
    event.preventDefault()
    if (saving) return
    if (transcript.trim().length < 20) {
      setMessage('Paste the interview transcript before generating the final report.')
      return
    }
    if (transcript.length > 200_000) {
      setMessage('The transcript must be 200,000 characters or fewer.')
      return
    }
    if (!approvedPlanVersion) {
      setMessage('The approved plan version is missing. Return to the interview plan and open this step again.')
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const result = await saveInterviewTranscript(interviewId, {
        approvedPlanVersion,
        transcript,
        interviewerNotes: notes,
        removeContactDetails,
      })
      setMessage(`Transcript saved securely (${result.wordCount} words). Generating the evidence report…`)
      await generateInterviewReport(interviewId)
      navigate(`/interviews/${interviewId}/report`)
    } catch (error) {
      console.error('Could not save interview transcript:', {
        code: error?.code || 'unknown',
        message: error?.message || 'No error message returned',
      })
      setMessage(interviewErrorMessage(error, 'Could not save the interview transcript. Please try again.'))
    } finally {
      setSaving(false)
    }
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

      <main className="page transcript-page">
        <Link className="interview-plan__back" to={`/interviews/${interviewId}/review`}>← View approved questions</Link>

        <header className="transcript-page__head">
          <span className="eyebrow">Interviews / {candidateName} / Transcript</span>
          <h1>Add interview transcript</h1>
          <p>
            {candidateName} · {jobTitle}
            {(approvedPlan?.totalQuestions || context.totalQuestions) ? ` · Approved plan: ${approvedPlan?.totalQuestions || context.totalQuestions} questions, ${approvedPlan?.totalMinutes || context.totalMinutes} min` : ''}
          </p>
        </header>

        <div className="transcript-steps" aria-label="Interview progress">
          <span className="is-complete">✓ Plan approved</span>
          <span>Interview conducted externally</span>
          <span className="is-active">Transcript</span>
          <span>Final report</span>
        </div>

        <form className="transcript-layout" onSubmit={prepareFinalReport}>
          <section className="glass glass--lg transcript-editor">
            <div className="transcript-editor__head">
              <div><span className="eyebrow">Transcript</span><h2>Paste the full transcript</h2></div>
              <button className="btn" type="button" onClick={clearTranscript}>Clear</button>
            </div>
            <p>Paste the transcript from your meeting tool or notes in its original format. Speaker labels are not required; Gemini will use the candidate name and conversation context.</p>
            <textarea
              value={transcript}
              onChange={event => { setTranscript(event.target.value); setMessage('') }}
              placeholder="Paste the complete transcript here. It may include names, timestamps, headings, or plain interview notes."
              aria-label="Full interview transcript"
              spellCheck="true"
              maxLength="200000"
            />
            <div className="transcript-editor__stats">
              <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
              <span>{transcript.length.toLocaleString()} characters</span>
              <span>Draft saved in this browser session</span>
            </div>

            <label className="transcript-privacy">
              <input type="checkbox" checked={removeContactDetails} onChange={event => setRemoveContactDetails(event.target.checked)} />
              <span><b>Remove phone numbers and email addresses before sending to Gemini</b><small>Enabled by default to reduce unnecessary personal information.</small></span>
            </label>
          </section>

          <aside className="transcript-sidebar">
            <section className="glass glass--lg transcript-notes">
              <span className="eyebrow">Optional</span>
              <h2>Recruiter notes</h2>
              <p>Add only job-related context that is not included in the transcript. These notes will remain separate from transcript evidence.</p>
              <textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="For example: the technical demonstration was completed before recording started."
                maxLength="3000"
              />
              <small>{notes.length}/3000 characters</small>
            </section>

            <section className="glass glass--lg transcript-action">
              <span className="eyebrow">Next step</span>
              <h2>Generate final report</h2>
              <p>The approved plan and answer guides will be used to assess the transcript. The hiring decision remains with the recruiter.</p>
              <Link className="btn" to={`/interviews/${interviewId}/review`}>View approved plan</Link>
              <button className="btn btn--primary" type="submit" disabled={saving}>{saving ? 'Generating report…' : 'Generate final report'}</button>
              {message && <div className="transcript-action__message" role="status">{message}</div>}
              <small>The transcript is saved first, then Gemini evaluates it against the approved plan. Duplicate report requests reuse the existing result.</small>
            </section>
          </aside>
        </form>
      </main>

      <footer className="footer">Who’s Next supports structured interviews. Hiring decisions stay with you.</footer>
    </div>
  )
}
