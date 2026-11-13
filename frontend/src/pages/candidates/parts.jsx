import { CANDIDATE_STAGES, stageTone } from '../../constants/statuses.js'
import { averageRating, isStale } from '../../utils/candidateModel.js'
import { daysSince, plural } from '../../utils/format.js'

export function Modal({ onClose, labelledBy, role = 'dialog', describedBy, small = false, children }) {
  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <section
        className={`modal__card cand-modal glass glass--strong${small ? ' cand-modal--small' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </section>
    </div>
  )
}

export function ModalHead({ id, title, text, badge, onClose, closeLabel, disabled }) {
  return (
    <div className="modal__head">
      <div>
        {badge}
        <h3 id={id}>{title}</h3>
        {text && <p>{text}</p>}
      </div>
      <button type="button" className="icon-btn" onClick={onClose} disabled={disabled} aria-label={closeLabel}>×</button>
    </div>
  )
}

export function StatusBadge({ status }) {
  return (
    <span className={`pill pill--${stageTone(status)}`}>
      <span className="dot" />
      {status}
    </span>
  )
}

export function Detail({ label, children }) {
  return (
    <div className="candidate-detail">
      <span>{label}</span>
      {children}
    </div>
  )
}

export function DialogIcon({ tone, children }) {
  return <div className={`candidate-dialog-icon candidate-dialog-icon--${tone}`} aria-hidden="true">{children}</div>
}

export function SkillList({ skills, max = 4 }) {
  if (!skills?.length) return null
  const shown = skills.slice(0, max)
  return (
    <span className="candidate-skill-list">
      {shown.map(skill => <span key={skill} className="candidate-skill">{skill}</span>)}
      {skills.length > max && <span className="candidate-skill">+{skills.length - max}</span>}
    </span>
  )
}

export function CandidateTags({ candidate }) {
  const average = averageRating(candidate)
  const stale = isStale(candidate)
  if (!average && !stale) return null

  return (
    <span className="candidate-tags">
      {average > 0 && (
        <span className="candidate-tag candidate-tag--rating" title={plural(candidate.ratingCount, 'interview rating')}>
          ★ {average.toFixed(1)}
        </span>
      )}
      {stale && (
        <span className="candidate-tag candidate-tag--stale" title={`No update for ${daysSince(candidate.updatedMs)} days`}>
          Follow up
        </span>
      )}
    </span>
  )
}

/** Stage dropdown used in the table and the profile. Unknown stored values stay selectable. */
export function StageSelect({ candidate, busy, onChange }) {
  const options = CANDIDATE_STAGES.includes(candidate.status) ? CANDIDATE_STAGES : [candidate.status, ...CANDIDATE_STAGES]
  return (
    <select
      className={`candidate-status-select pill--${stageTone(candidate.status)}`}
      value={candidate.status}
      disabled={busy}
      onChange={event => onChange(candidate, event.target.value)}
      aria-label={`Update stage for ${candidate.name}`}
    >
      {options.map(stage => <option key={stage} value={stage}>{stage}</option>)}
    </select>
  )
}

export function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(toast => (
        <div className={`toast toast--${toast.type}`} key={toast.id}>
          <span className="toast__dot" />
          <span className="toast__text">{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.onAction?.()
                onDismiss(toast.id)
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  )
}
