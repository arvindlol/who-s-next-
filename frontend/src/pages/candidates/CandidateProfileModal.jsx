import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Detail, Modal, ModalHead, SkillList, StageSelect, StatusBadge } from './parts.jsx'
import { subscribeToActivity } from '../../services/candidates.js'
import { averageRating, isStale } from '../../utils/candidateModel.js'
import { EMAIL_TEMPLATES, buildMailto } from '../../utils/email.js'
import { daysSince, formatDate, formatDateTime, plural } from '../../utils/format.js'

function stars(value) {
  const full = Math.max(0, Math.min(5, Math.round(value)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

export default function CandidateProfileModal({
  candidate,
  stageBusy,
  uploading,
  senderName,
  onStageChange,
  onSaveFeedback,
  onEmailDrafted,
  onEdit,
  onDelete,
  onClose,
}) {
  const [activity, setActivity] = useState([])
  const [rating, setRating] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [savingFeedback, setSavingFeedback] = useState(false)

  useEffect(() => {
    setActivity([])
    return subscribeToActivity(candidate.id, setActivity, error => {
      console.warn('History unavailable:', error?.code || error)
      setActivity([])
    })
  }, [candidate.id])

  const saveFeedback = async () => {
    setSavingFeedback(true)
    const saved = await onSaveFeedback(candidate, rating, feedback.trim())
    setSavingFeedback(false)
    if (saved) {
      setRating(0)
      setFeedback('')
    }
  }

  const hasResume = Boolean(candidate.resumeUrl || candidate.resumePath)

  return (
    <Modal onClose={onClose} labelledBy="candidate-details-title">
      <ModalHead
        id="candidate-details-title"
        badge={<StatusBadge status={candidate.status} />}
        title={candidate.name}
        text={candidate.role ? `${candidate.role} · Candidate profile` : 'Candidate profile'}
        onClose={onClose}
        closeLabel="Close candidate details"
      />

      {isStale(candidate) && (
        <div className="candidate-followup" role="note">
          No update for {daysSince(candidate.updatedMs)} days. Move them to the next stage, add feedback, or send a quick email below.
        </div>
      )}

      <div className="candidate-details">
        <Detail label="Hiring stage">
          <StageSelect candidate={candidate} busy={stageBusy} onChange={onStageChange} />
        </Detail>

        <Detail label="Applying for"><strong>{candidate.role || 'Role not specified'}</strong></Detail>

        <Detail label="Key skills">
          {candidate.skills.length ? <SkillList skills={candidate.skills} max={30} /> : <strong>No skills added yet</strong>}
        </Detail>

        <Detail label="Email address">
          <strong>{candidate.email ? <a href={`mailto:${candidate.email}`}>{candidate.email}</a> : 'No email on file'}</strong>
        </Detail>

        <Detail label="Phone">
          <strong>{candidate.phone ? <a href={`tel:${candidate.phone}`}>{candidate.phone}</a> : 'No phone on file'}</strong>
        </Detail>

        <Detail label="Resume">
          <strong>
            {uploading ? 'Uploading resume…' : hasResume && candidate.resumeUrl ? (
              <a href={candidate.resumeUrl} target="_blank" rel="noopener noreferrer">{candidate.resumeName || 'Open resume'}</a>
            ) : hasResume ? (candidate.resumeName || 'Resume on file') : 'No resume yet — add a PDF to screen this candidate'}
          </strong>
        </Detail>

        <Detail label="Notes"><strong className="candidate-notes">{candidate.notes || 'No notes added yet.'}</strong></Detail>

        <Detail label="Added on"><strong>{formatDate(candidate.createdMs)}</strong></Detail>

        {hasResume && (
          <Detail label="Next step">
            <Link className="btn btn--small" to="/screening?new=true" onClick={onClose}>Screen against a job</Link>
          </Detail>
        )}

        <Detail label="Quick email">
          {candidate.email ? (
            <div className="email-templates">
              {EMAIL_TEMPLATES.map(template => (
                <a
                  key={template.key}
                  className="btn btn--small"
                  href={buildMailto(candidate, template, senderName)}
                  onClick={() => onEmailDrafted(candidate, template)}
                >
                  {template.label}
                </a>
              ))}
            </div>
          ) : <strong>No email on file</strong>}
        </Detail>

        <Detail label={`Interview feedback${candidate.ratingCount > 0 ? ` · average ${averageRating(candidate).toFixed(1)} from ${candidate.ratingCount}` : ''}`}>
          <div className="rating-input" role="group" aria-label="Rate this candidate">
            {[1, 2, 3, 4, 5].map(value => (
              <button
                key={value}
                type="button"
                className={value <= rating ? 'is-on' : ''}
                aria-pressed={rating === value}
                aria-label={plural(value, 'star')}
                onClick={() => setRating(rating === value ? 0 : value)}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            className="feedback-input"
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
            placeholder="What stood out in the interview? Strengths, concerns, next steps…"
            rows="2"
            maxLength={1000}
            aria-label="Interview feedback"
          />
          <button type="button" className="btn btn--small feedback-save" onClick={saveFeedback} disabled={savingFeedback || !rating}>
            {savingFeedback ? 'Saving…' : 'Save feedback'}
          </button>
        </Detail>

        <Detail label="History">
          {activity.length === 0 ? (
            <strong className="candidate-notes">Changes and feedback will appear here.</strong>
          ) : (
            <ol className="timeline">
              {activity.map(item => (
                <li key={item.id} className={`timeline__item timeline__item--${item.type}`}>
                  <span className="timeline__dot" aria-hidden="true" />
                  <div>
                    <p>
                      {item.type === 'feedback' && <span className="timeline__stars">{stars(item.rating)} </span>}
                      {item.text || (item.type === 'feedback' ? 'Rated' : '')}
                    </p>
                    <small>{item.by ? `${item.by} · ` : ''}{formatDateTime(item.ms)}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Detail>
      </div>

      <div className="modal__actions modal__actions--split">
        <button type="button" className="btn btn--danger" onClick={() => onDelete([candidate])}>Delete candidate</button>
        <div className="cand-actions-group">
          <button type="button" className="btn" onClick={() => onEdit(candidate)}>Edit</button>
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  )
}
