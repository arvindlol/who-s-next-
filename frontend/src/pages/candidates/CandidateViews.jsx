import { CANDIDATE_STAGES } from '../../constants/statuses.js'
import { formatDate } from '../../utils/format.js'
import { CandidateTags, SkillList, StageSelect, StatusBadge } from './parts.jsx'

export function CandidateTable({
  candidates,
  totalFiltered,
  selectedIds,
  highlightId,
  uploadingIds,
  updatingStageId,
  onToggle,
  onToggleAll,
  onOpen,
  onEdit,
  onDelete,
  onStageChange,
  onShowMore,
}) {
  const allSelected = candidates.length > 0 && candidates.every(candidate => selectedIds.has(candidate.id))
  const someSelected = candidates.some(candidate => selectedIds.has(candidate.id))

  return (
    <div className="jobs-table-scroll">
      <table className="jobs-table cand-table">
        <thead>
          <tr>
            <th className="cand-table__check">
              <input
                type="checkbox"
                checked={allSelected}
                ref={element => {
                  if (element) element.indeterminate = someSelected && !allSelected
                }}
                onChange={onToggleAll}
                aria-label="Select all candidates shown"
              />
            </th>
            <th>Candidate</th>
            <th>Role</th>
            <th>Stage</th>
            <th>Added</th>
            <th><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {candidates.map(candidate => {
            const checked = selectedIds.has(candidate.id)
            return (
              <tr key={candidate.id} className={`${highlightId === candidate.id ? 'candidate--new' : ''} ${checked ? 'candidate--selected' : ''}`}>
                <td className="cand-table__check">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(candidate.id)} aria-label={`Select ${candidate.name}`} />
                </td>
                <td data-label="Candidate">
                  <button type="button" className="candidate__name" onClick={() => onOpen(candidate.id)} aria-label={`Open ${candidate.name}`}>
                    <b className="job-title">{candidate.name}</b>
                    <small>{candidate.email || 'Candidate profile'}</small>
                  </button>
                  <CandidateTags candidate={candidate} />
                </td>
                <td data-label="Role">
                  {candidate.role}
                  <SkillList skills={candidate.skills} max={3} />
                </td>
                <td data-label="Stage">
                  <StageSelect candidate={candidate} busy={updatingStageId === candidate.id} onChange={onStageChange} />
                </td>
                <td data-label="Added">{formatDate(candidate.createdMs)}</td>
                <td className="jobs-table__actions">
                  {uploadingIds.has(candidate.id) ? (
                    <span className="candidate-resume-state candidate-resume-state--busy">Uploading…</span>
                  ) : candidate.resumeUrl ? (
                    <a className="btn btn--small" href={candidate.resumeUrl} target="_blank" rel="noopener noreferrer">Resume</a>
                  ) : (
                    <span className="candidate-resume-state candidate-resume-state--missing" title="Add a PDF resume to screen this candidate">No resume</span>
                  )}
                  <button type="button" className="btn btn--primary btn--small" onClick={() => onOpen(candidate.id)}>View</button>
                  <button type="button" className="cand-icon-btn" title={`Edit ${candidate.name}`} aria-label={`Edit ${candidate.name}`} onClick={() => onEdit(candidate)}>✎</button>
                  <button type="button" className="cand-icon-btn cand-icon-btn--danger" title={`Delete ${candidate.name}`} aria-label={`Delete ${candidate.name}`} onClick={() => onDelete([candidate])}>🗑</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {totalFiltered > candidates.length && (
        <div className="candidates__more">
          <button type="button" className="btn btn--small" onClick={onShowMore}>
            Show more ({totalFiltered - candidates.length} left)
          </button>
        </div>
      )}
    </div>
  )
}

export function CandidateBoard({ groups, dragOverStage, highlightId, onDragOverStage, onDrop, onOpen }) {
  return (
    <div className="candidate-board" aria-label="Hiring pipeline">
      {CANDIDATE_STAGES.map(stage => {
        const items = groups[stage] || []
        return (
          <div
            key={stage}
            className={`board-col ${dragOverStage === stage ? 'board-col--over' : ''}`}
            onDragOver={event => {
              event.preventDefault()
              onDragOverStage(stage)
            }}
            onDragLeave={() => onDragOverStage(current => (current === stage ? null : current))}
            onDrop={event => onDrop(event, stage)}
          >
            <div className="board-col__head">
              <StatusBadge status={stage} />
              <span className="candidate-chip__count">{items.length}</span>
            </div>
            <div className="board-col__body">
              {items.length === 0 ? (
                <p className="board-col__empty">Drop a card here</p>
              ) : items.map(candidate => (
                <div
                  key={candidate.id}
                  className={`board-card ${highlightId === candidate.id ? 'candidate--new' : ''}`}
                  draggable
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${candidate.name}`}
                  onDragStart={event => {
                    event.dataTransfer.setData('text/plain', candidate.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => onOpen(candidate.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpen(candidate.id)
                    }
                  }}
                >
                  <b>{candidate.name}</b>
                  <span>{candidate.role}</span>
                  <CandidateTags candidate={candidate} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
