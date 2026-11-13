// Workflow vocabularies. Mirrors functions/src/lib/statuses.js — keep both in sync.

export const CANDIDATE_STAGES = [
  'Screening',
  'Resume Reviewed',
  'JD Matched',
  'Shortlisted',
  'Interview Pending',
  'Interview Scheduled',
  'Interview Ready',
  'Offer',
  'Hired',
  'Rejected',
]

// Stages where a candidate is finished, so no follow-up reminder is needed.
export const CLOSED_STAGES = ['Hired', 'Rejected']

const STAGE_ALIASES = { selected: 'Hired', dropped: 'Rejected' }

/** Maps any stored value (incl. older spellings like "Interview ready" or "Selected") to a stage. */
export function normalizeStage(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Screening'
  const key = value.trim().toLowerCase()
  if (STAGE_ALIASES[key]) return STAGE_ALIASES[key]
  return CANDIDATE_STAGES.find(stage => stage.toLowerCase() === key) || value.trim()
}

/** Pill colour for a stage: live | ok | warn | danger. */
export function stageTone(stage = '') {
  const value = normalizeStage(stage)
  if (value === 'Interview Ready' || value === 'Offer' || value === 'Hired') return 'live'
  if (value === 'JD Matched' || value === 'Resume Reviewed' || value === 'Shortlisted') return 'ok'
  if (value === 'Rejected') return 'danger'
  return 'warn'
}

export const INTERVIEW_STATUS = {
  PLAN_NEEDED: 'plan_needed',
  PLAN_READY: 'plan_ready',
  PLAN_APPROVED: 'plan_approved',
  TRANSCRIPT_SUBMITTED: 'transcript_submitted',
  REPORT_READY: 'report_ready',
  DECIDED: 'decided',
}

export const INTERVIEW_STEPS = [
  { n: 1, title: 'Create plan', desc: 'Build questions from the role, resume and screening evidence.', ai: true },
  { n: 2, title: 'Review & approve', desc: 'Edit the questions and approve the interview plan.', ai: false },
  { n: 3, title: 'Interview takes place', desc: 'You run it outside Who’s Next using the approved plan.', ai: false },
  { n: 4, title: 'Add transcript', desc: 'Paste the transcript of the completed interview.', ai: false },
  { n: 5, title: 'Final report', desc: 'Review evidence and scores, then record your decision.', ai: true },
]

export const DECISIONS = [
  { value: 'offer', label: 'Move to offer' },
  { value: 'another', label: 'Another interview' },
  { value: 'reject', label: 'Do not progress' },
]

const LEGACY_INTERVIEW_STATUSES = {
  draft: 'plan_needed',
  approved: 'plan_approved',
  scheduled: 'plan_approved',
  invited: 'plan_approved',
  in_progress: 'plan_approved',
  awaiting_transcript: 'plan_approved',
  completed: 'transcript_submitted',
  reviewed: 'decided',
}

export function interviewStatusKey(value) {
  const key = String(value || 'plan_needed').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return LEGACY_INTERVIEW_STATUSES[key] || key
}

/** Label, colour, workflow step and next action for an interview. */
export function interviewStatusDetails(interview) {
  const status = interviewStatusKey(interview?.status)
  const id = interview?.id
  const decisionLabel = DECISIONS.find(item => item.value === interview?.decision)?.label

  const details = {
    plan_needed: { label: 'Plan needed', tone: 'warn', step: 1, action: 'Create plan', to: `/interviews/${id}/plan` },
    plan_ready: { label: 'Plan ready for review', tone: 'live', step: 2, action: 'Review plan', to: `/interviews/${id}/review` },
    plan_approved: { label: 'Plan approved', tone: 'live', step: 3, action: 'Add transcript', to: `/interviews/${id}/transcript` },
    transcript_submitted: { label: 'Transcript added', tone: 'warn', step: 4, action: 'Generate report', to: `/interviews/${id}/transcript` },
    report_ready: { label: 'Report ready', tone: 'ok', step: 5, action: 'View report', to: `/interviews/${id}/report` },
    decided: { label: decisionLabel ? `Decided: ${decisionLabel}` : 'Decided', tone: interview?.decision === 'reject' ? 'danger' : 'ok', step: 5, action: 'View report', to: `/interviews/${id}/report` },
  }

  return details[status] || { label: status.replace(/_/g, ' '), tone: 'warn', step: 1, action: 'Open interview', to: `/interviews/${id}/plan` }
}

/** Interviews that still need recruiter work (everything before a decision). */
export function isInterviewPending(status) {
  return interviewStatusKey(status) !== INTERVIEW_STATUS.DECIDED
}
