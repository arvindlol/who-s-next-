import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { INTERVIEW_STATUS, interviewStatusKey } from '../constants/statuses.js'
import {
  generateFinalReport,
  interviewErrorMessage,
  submitTranscript,
  subscribeToInterview,
  subscribeToTranscript,
} from '../services/interviews.js'
import { normalizeTranscriptText, suggestedSpeakerRole, transcriptSpeakers } from '../utils/transcript.js'

const MIN_CHARS = 200
const MAX_CHARS = 200_000
const MAX_FILE_BYTES = 2 * 1024 * 1024

function readSession(key) {
  try {
    return window.sessionStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeSession(key, value) {
  try {
    if (value) window.sessionStorage.setItem(key, value)
    else window.sessionStorage.removeItem(key)
  } catch {
    // Storage unavailable (private mode): the draft simply isn't kept.
  }
}

export default function InterviewTranscriptPage() {
  const { interviewId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const draftKey = `whos-next:transcript-draft:${interviewId}`
  const notesKey = `whos-next:transcript-notes:${interviewId}`

  const [interview, setInterview] = useState(null)
  const [saved, setSaved] = useState(undefined) // undefined = loading, null = none
  const [loadError, setLoadError] = useState('')
  const [transcript, setTranscript] = useState(() => readSession(draftKey))
  const [notes, setNotes] = useState(() => readSession(notesKey))
  const [initialised, setInitialised] = useState(false)
  const [redact, setRedact] = useState(true)
  const [speakerRoles, setSpeakerRoles] = useState({})
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    if (!user?.uid || !interviewId) return undefined
    const stopInterview = subscribeToInterview(user.uid, interviewId, {
      onChange: next => {
        setInterview(next)
        setLoadError('')
      },
      onMissing: () => setLoadError('This interview could not be found.'),
      onError: error => {
        console.error('Could not load the interview:', error)
        setLoadError('Could not load this interview. Please try again.')
      },
    })
    const stopTranscript = subscribeToTranscript(interviewId, setSaved, () => setSaved(null))
    return () => {
      stopInterview()
      stopTranscript()
    }
  }, [interviewId, user?.uid])

  // Prefer the submitted transcript over a local draft the first time it loads.
  useEffect(() => {
    if (initialised || saved === undefined) return
    if (saved?.transcript && !readSession(draftKey)) {
      setTranscript(saved.transcript)
      setNotes(saved.notes || '')
      setSpeakerRoles(saved.speakerRoles || {})
      setRedact(saved.redacted !== false)
    }
    setInitialised(true)
  }, [saved, initialised, draftKey])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      writeSession(draftKey, transcript)
      writeSession(notesKey, notes)
    }, 400)
    return () => window.clearTimeout(timeout)
  }, [draftKey, notesKey, transcript, notes])

  const candidateName = interview?.candidateName || 'Candidate'
  const speakers = useMemo(() => transcriptSpeakers(transcript, candidateName), [transcript, candidateName])

  useEffect(() => {
    setSpeakerRoles(current => {
      const next = {}
      speakers.forEach(label => { next[label] = current[label] || suggestedSpeakerRole(label, candidateName) })
      return next
    })
  }, [speakers, candidateName])

  if (loadError) {
    return (
      <AppLayout mainClassName="page transcript-page">
        <div className="workflow-notice" role="alert"><b>Interview unavailable</b><span>{loadError}</span><Link className="btn btn--small" to="/interviews">Back to interviews</Link></div>
      </AppLayout>
    )
  }

  if (!interview || saved === undefined) {
    return <AppLayout mainClassName="page transcript-page"><p className="report-state">Loading interview…</p></AppLayout>
  }

  const status = interviewStatusKey(interview.status)
  const planApproved = [INTERVIEW_STATUS.PLAN_APPROVED, INTERVIEW_STATUS.TRANSCRIPT_SUBMITTED, INTERVIEW_STATUS.REPORT_READY, INTERVIEW_STATUS.DECIDED].includes(status)
  const decided = status === INTERVIEW_STATUS.DECIDED
  const hasSubmitted = Boolean(saved?.transcript)
  const changedSinceSubmit = hasSubmitted && (saved.transcript !== transcript || (saved.notes || '') !== notes)
  const reportRunning = interview.reportGeneration?.status === 'running' || busy === 'report'
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0
  const totalQuestions = interview.plan?.totalQuestions || (interview.plan?.sections || []).reduce((total, section) => total + (section.questions?.length || 0), 0)

  const importFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/\.(txt|vtt|srt)$/i.test(file.name)) return setMessage({ type: 'error', text: 'Import a .txt, .vtt or .srt transcript file.' })
    if (file.size > MAX_FILE_BYTES) return setMessage({ type: 'error', text: 'That file is larger than 2 MB.' })
    if (transcript.trim() && !window.confirm('Replace the current transcript with this file?')) return
    setTranscript(normalizeTranscriptText(await file.text(), file.name))
    setMessage({ type: 'success', text: `Imported ${file.name}. Check the speaker labels below.` })
  }

  const submit = async event => {
    event.preventDefault()
    if (transcript.trim().length < MIN_CHARS) return setMessage({ type: 'error', text: `Paste the full transcript (at least ${MIN_CHARS} characters).` })
    if (transcript.length > MAX_CHARS) return setMessage({ type: 'error', text: `The transcript is too long (maximum ${MAX_CHARS.toLocaleString()} characters).` })
    if (!Object.values(speakerRoles).includes('candidate')) return setMessage({ type: 'error', text: 'Identify which speaker is the candidate.' })
    if (status === INTERVIEW_STATUS.REPORT_READY && !window.confirm('Saving a new transcript removes the current report. Continue?')) return

    setBusy('submit')
    setMessage({ type: '', text: '' })
    try {
      const result = await submitTranscript({ interviewId, transcript, speakerRoles, notes, redactContacts: redact })
      writeSession(draftKey, '')
      writeSession(notesKey, '')
      const removed = (result.redactions?.emails || 0) + (result.redactions?.phones || 0)
      setMessage({ type: 'success', text: `Transcript saved${removed ? ` (${removed} contact detail${removed === 1 ? '' : 's'} removed)` : ''}. You can now generate the report.` })
    } catch (error) {
      setMessage({ type: 'error', text: interviewErrorMessage(error, 'The transcript could not be saved. Please try again.') })
    } finally {
      setBusy('')
    }
  }

  const generate = async () => {
    setBusy('report')
    setMessage({ type: '', text: '' })
    try {
      await generateFinalReport(interviewId)
      navigate(`/interviews/${interviewId}/report`)
    } catch (error) {
      setMessage({ type: 'error', text: interviewErrorMessage(error, 'The report could not be generated. Please try again.') })
      setBusy('')
    }
  }

  return (
    <AppLayout mainClassName="page transcript-page" footer="Who’s Next supports structured interviews. Hiring decisions stay with you.">
      <Link className="interview-plan__back" to={`/interviews/${interviewId}/review`}>← Interview plan</Link>

      <header className="transcript-page__head">
        <span className="eyebrow">Interviews / {candidateName} / Transcript</span>
        <h1>Interview transcript</h1>
        <p>{candidateName} · {interview.jobTitle}{totalQuestions ? ` · Approved plan: ${totalQuestions} questions, ${interview.plan?.totalMinutes || '–'} min` : ''}</p>
      </header>

      <div className="transcript-steps" aria-label="Interview progress">
        <span className={planApproved ? 'is-complete' : 'is-active'}>{planApproved ? '✓ ' : ''}Plan approved</span>
        <span className={planApproved ? 'is-complete' : ''}>Interview conducted</span>
        <span className={hasSubmitted ? 'is-complete' : planApproved ? 'is-active' : ''}>{hasSubmitted ? '✓ ' : ''}Transcript</span>
        <span className={[INTERVIEW_STATUS.REPORT_READY, INTERVIEW_STATUS.DECIDED].includes(status) ? 'is-complete' : hasSubmitted ? 'is-active' : ''}>Final report</span>
      </div>

      {!planApproved && (
        <div className="workflow-notice" role="note">
          <b>Approve the interview plan first.</b>
          <span>The report scores the transcript against the approved plan.</span>
          <Link className="btn btn--small" to={`/interviews/${interviewId}/review`}>Review plan</Link>
        </div>
      )}
      {decided && (
        <div className="workflow-notice" role="note">
          <b>A decision has been recorded.</b>
          <span>The transcript can no longer change.</span>
          <Link className="btn btn--small" to={`/interviews/${interviewId}/report`}>View report</Link>
        </div>
      )}

      <form className="transcript-layout" onSubmit={submit}>
        <section className="glass glass--lg transcript-editor">
          <div className="transcript-editor__head">
            <div><span className="eyebrow">Transcript</span><h2>Paste or import the full transcript</h2></div>
            <div className="transcript-editor__tools">
              <button className="btn" type="button" onClick={() => fileInputRef.current?.click()} disabled={!planApproved || decided}>Import file</button>
              <button className="btn" type="button" onClick={() => { if (!transcript || window.confirm('Clear the transcript?')) setTranscript('') }} disabled={decided}>Clear</button>
              <input ref={fileInputRef} type="file" accept=".txt,.vtt,.srt,text/plain,text/vtt" className="visually-hidden" onChange={importFile} aria-label="Import transcript file" />
            </div>
          </div>
          <p>Paste the transcript from your meeting tool or import a .txt, .vtt or .srt export. Keep each speaker label at the start of a line, for example “Interviewer:”.</p>
          <textarea
            value={transcript}
            onChange={event => { setTranscript(event.target.value); setMessage({ type: '', text: '' }) }}
            placeholder={'Interviewer: Thanks for joining us.\n\nCandidate: Thank you for having me.'}
            aria-label="Full interview transcript"
            spellCheck="true"
            readOnly={!planApproved || decided}
          />
          <div className="transcript-editor__stats">
            <span>{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
            <span>{transcript.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters</span>
            <span>{hasSubmitted ? (changedSinceSubmit ? 'Unsaved changes' : 'Saved') : 'Draft kept in this browser tab'}</span>
          </div>

          <section className="speaker-mapping">
            <div><h3>Who is who?</h3><p>Confirm how the speaker labels should be read.</p></div>
            <div className="speaker-mapping__grid">
              {speakers.map(label => (
                <label key={label}>
                  <span>“{label}” is</span>
                  <select value={speakerRoles[label] || 'other'} onChange={event => setSpeakerRoles(current => ({ ...current, [label]: event.target.value }))} disabled={decided}>
                    <option value="interviewer">Interviewer</option>
                    <option value="candidate">Candidate</option>
                    <option value="other">Other participant</option>
                  </select>
                </label>
              ))}
            </div>
          </section>

          <label className="transcript-privacy">
            <input type="checkbox" checked={redact} onChange={event => setRedact(event.target.checked)} disabled={decided} />
            <span><b>Remove phone numbers and email addresses before saving</b><small>On by default, so unnecessary personal details are not stored or sent to Gemini.</small></span>
          </label>
        </section>

        <aside className="transcript-sidebar">
          <section className="glass glass--lg transcript-notes">
            <span className="eyebrow">Optional</span>
            <h2>Recruiter notes</h2>
            <p>Add only job-related context that isn’t in the transcript. Notes are kept separate from transcript evidence.</p>
            <textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="For example: the technical demonstration was completed before recording started." maxLength="3000" readOnly={decided} />
            <small>{notes.length}/3000 characters</small>
          </section>

          <section className="glass glass--lg transcript-action">
            <span className="eyebrow">Next step</span>
            <h2>Save transcript, then generate the report</h2>
            <p>The approved plan and its answer guides are used to assess the transcript. The decision stays with you.</p>
            <button className="btn btn--primary" type="submit" disabled={!planApproved || decided || Boolean(busy) || (hasSubmitted && !changedSinceSubmit)}>
              {busy === 'submit' ? 'Saving…' : hasSubmitted ? 'Save changes' : 'Save transcript'}
            </button>
            {hasSubmitted && !decided && (
              status === INTERVIEW_STATUS.REPORT_READY ? (
                <Link className="btn" to={`/interviews/${interviewId}/report`}>View report</Link>
              ) : (
                <button className="btn" type="button" onClick={generate} disabled={reportRunning || changedSinceSubmit}>
                  {reportRunning ? 'Generating report…' : 'Generate final report'}
                </button>
              )
            )}
            {reportRunning && <small role="status">Gemini is assessing the transcript. This usually takes under a minute.</small>}
            {!reportRunning && interview.reportGeneration?.status === 'failed' && !message.text && (
              <div className="transcript-action__message transcript-action__message--error" role="alert">The last attempt failed: {interview.reportGeneration.message}</div>
            )}
            {message.text && <div className={`transcript-action__message transcript-action__message--${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}
          </section>
        </aside>
      </form>
    </AppLayout>
  )
}
