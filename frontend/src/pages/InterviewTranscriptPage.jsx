import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useParams } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'

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

function transcriptSpeakers(transcript, candidateName) {
  const labels = []
  const seen = new Set()
  const matcher = /^\s*([^:\n]{1,40}):/gm
  let match = matcher.exec(transcript)

  while (match) {
    const label = match[1].trim()
    const key = label.toLowerCase()
    if (label && !seen.has(key)) {
      labels.push(label)
      seen.add(key)
    }
    if (labels.length >= 6) break
    match = matcher.exec(transcript)
  }

  if (labels.length === 0) {
    return ['Interviewer', candidateName?.split(/\s+/)[0] || 'Candidate']
  }
  return labels
}

function suggestedSpeakerRole(label, candidateName) {
  const normalized = label.toLowerCase()
  const candidateFirstName = candidateName?.split(/\s+/)[0]?.toLowerCase()
  if (/interviewer|recruiter|hiring manager/.test(normalized)) return 'interviewer'
  if (normalized === 'candidate' || (candidateFirstName && normalized === candidateFirstName)) return 'candidate'
  return 'other'
}

export default function InterviewTranscriptPage() {
  const { interviewId } = useParams()
  const location = useLocation()
  const { user, signOut } = useAuth()
  const contextKey = `whos-next:transcript-context:${interviewId}`
  const draftKey = `whos-next:transcript-draft:${interviewId}`
  const notesKey = `whos-next:transcript-notes:${interviewId}`
  const context = location.state?.transcriptContext || readSessionJson(contextKey) || {}
  const [transcript, setTranscript] = useState(() => readSessionText(draftKey))
  const [notes, setNotes] = useState(() => readSessionText(notesKey))
  const [removeContactDetails, setRemoveContactDetails] = useState(true)
  const [speakerRoles, setSpeakerRoles] = useState({})
  const [message, setMessage] = useState('')
  const candidateName = context.candidateName || 'Candidate'
  const jobTitle = context.jobTitle || 'Candidate interview'
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()
  const speakers = useMemo(
    () => transcriptSpeakers(transcript, candidateName),
    [candidateName, transcript],
  )
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0

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

  useEffect(() => {
    setSpeakerRoles(current => {
      const next = { ...current }
      speakers.forEach(label => {
        if (!next[label]) next[label] = suggestedSpeakerRole(label, candidateName)
      })
      return next
    })
  }, [candidateName, speakers])

  const clearTranscript = () => {
    if (transcript && !window.confirm('Clear the transcript from this browser draft?')) return
    setTranscript('')
    setMessage('')
  }

  const prepareFinalReport = event => {
    event.preventDefault()
    if (transcript.trim().length < 20) {
      setMessage('Paste the interview transcript before generating the final report.')
      return
    }
    if (!Object.values(speakerRoles).includes('candidate')) {
      setMessage('Identify which speaker is the candidate before continuing.')
      return
    }
    setMessage('Transcript is ready. Final-report generation will be connected when the backend phase is implemented.')
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
        <Link className="interview-plan__back" to={`/interviews/${interviewId}/review`}>← Interview plan</Link>

        <header className="transcript-page__head">
          <span className="eyebrow">Interviews / {candidateName} / Transcript</span>
          <h1>Add interview transcript</h1>
          <p>
            {candidateName} · {jobTitle}
            {context.totalQuestions ? ` · Approved plan: ${context.totalQuestions} questions, ${context.totalMinutes} min` : ''}
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
            <p>Paste the transcript from your meeting tool or notes. Keep each speaker label at the start of a line, for example, “Interviewer:”.</p>
            <textarea
              value={transcript}
              onChange={event => { setTranscript(event.target.value); setMessage('') }}
              placeholder={'Interviewer: Thanks for joining us.\n\nCandidate: Thank you for having me.'}
              aria-label="Full interview transcript"
              spellCheck="true"
            />
            <div className="transcript-editor__stats">
              <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
              <span>{transcript.length.toLocaleString()} characters</span>
              <span>Draft saved in this browser session</span>
            </div>

            <section className="speaker-mapping">
              <div><h3>Who is who?</h3><p>Confirm how the speaker labels should be interpreted.</p></div>
              <div className="speaker-mapping__grid">
                {speakers.map(label => (
                  <label key={label}>
                    <span>“{label}” is</span>
                    <select
                      value={speakerRoles[label] || suggestedSpeakerRole(label, candidateName)}
                      onChange={event => setSpeakerRoles(current => ({ ...current, [label]: event.target.value }))}
                    >
                      <option value="interviewer">Interviewer</option>
                      <option value="candidate">Candidate</option>
                      <option value="other">Other participant</option>
                    </select>
                  </label>
                ))}
              </div>
            </section>

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
              <button className="btn btn--primary" type="submit">Generate final report</button>
              {message && <div className="transcript-action__message" role="status">{message}</div>}
              <small>Frontend preview only. Nothing is currently sent to Gemini or Firebase.</small>
            </section>
          </aside>
        </form>
      </main>

      <footer className="footer">Who’s Next supports structured interviews. Hiring decisions stay with you.</footer>
    </div>
  )
}
