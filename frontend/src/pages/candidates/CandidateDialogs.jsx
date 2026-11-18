import { DialogIcon, Modal } from './parts.jsx'
import { getInitials, plural } from '../../utils/format.js'

export function DeleteCandidatesDialog({ targets, deleting, onConfirm, onCancel }) {
  const many = targets.length > 1

  return (
    <Modal small role="alertdialog" onClose={() => !deleting && onCancel()} labelledBy="candidate-delete-title" describedBy="candidate-delete-text">
      <DialogIcon tone="danger">🗑</DialogIcon>
      <h3 id="candidate-delete-title" className="cand-dialog__title">
        {many ? `Delete ${targets.length} candidates?` : 'Delete this candidate?'}
      </h3>

      <div className="dialog-person">
        <span className="dialog-person__avatar" aria-hidden="true">{many ? targets.length : getInitials(targets[0].name)}</span>
        <div className="dialog-person__info">
          {many ? (
            <>
              <b>{targets.slice(0, 3).map(candidate => candidate.name).join(', ')}{targets.length > 3 ? ` and ${targets.length - 3} more` : ''}</b>
              <span>Selected candidates</span>
            </>
          ) : (
            <>
              <b>{targets[0].name}</b>
              <span>{[targets[0].role, targets[0].status].filter(Boolean).join(' · ')}</span>
            </>
          )}
        </div>
      </div>

      <p id="candidate-delete-text" className="cand-dialog__text">
        {many ? 'Their profiles, resumes, interviews and reports' : 'Their profile, resume, interviews and reports'} will be permanently deleted.
        You can undo for a few seconds right after.
      </p>

      <div className="modal__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={deleting} autoFocus>
          {many ? 'Keep them' : 'Keep candidate'}
        </button>
        <button type="button" className="btn btn--danger btn--danger-solid" onClick={onConfirm} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Yes, delete'}
        </button>
      </div>
    </Modal>
  )
}

export function NoticeDialog({ notice, onClose, onViewProfile, onAddAnother }) {
  return (
    <Modal small role="alertdialog" onClose={onClose} labelledBy="candidate-notice-title">
      {notice.type === 'added' && (
        <>
          <DialogIcon tone="success">✓</DialogIcon>
          <h3 id="candidate-notice-title" className="cand-dialog__title">Candidate added</h3>
          <p className="cand-dialog__text"><strong>{notice.name}</strong> is now in your pipeline.</p>
          <dl className="notice-summary">
            <div><dt>Applying for</dt><dd>{notice.role}</dd></div>
            <div><dt>Email</dt><dd>{notice.email}</dd></div>
            <div><dt>Stage</dt><dd>Screening</dd></div>
            <div><dt>Resume</dt><dd>{notice.resumeName ? `${notice.resumeName} · uploading` : 'Not attached yet (needed for screening)'}</dd></div>
          </dl>
          <div className="notice-actions">
            <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>Done</button>
            <div className="notice-actions__row">
              <button type="button" className="btn" onClick={() => onViewProfile(notice.candidateId)}>View profile</button>
              <button type="button" className="btn" onClick={onAddAnother}>Add another</button>
            </div>
          </div>
        </>
      )}

      {notice.type === 'import' && (
        <>
          <DialogIcon tone={notice.added > 0 ? 'success' : 'danger'}>{notice.added > 0 ? '✓' : '!'}</DialogIcon>
          <h3 id="candidate-notice-title" className="cand-dialog__title">{notice.added > 0 ? 'Import finished' : 'Nothing imported'}</h3>
          <p className="cand-dialog__text">
            {notice.added > 0
              ? `${plural(notice.added, 'new candidate')} ${notice.added === 1 ? 'was' : 'were'} added at the Screening stage. Add a PDF resume to each before screening.`
              : 'No new candidates were found in that file.'}
          </p>
          <dl className="notice-summary">
            <div><dt>Added</dt><dd>{notice.added}</dd></div>
            <div><dt>Already on your list</dt><dd>{notice.skippedDuplicate}</dd></div>
            <div><dt>Skipped (missing name or invalid email)</dt><dd>{notice.skippedInvalid}</dd></div>
          </dl>
          <div className="modal__actions">
            <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>Done</button>
          </div>
        </>
      )}

      {notice.type === 'error' && (
        <>
          <DialogIcon tone="danger">!</DialogIcon>
          <h3 id="candidate-notice-title" className="cand-dialog__title">{notice.title}</h3>
          <p className="cand-dialog__text">{notice.message}</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>Got it</button>
          </div>
        </>
      )}
    </Modal>
  )
}
