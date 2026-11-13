'use strict'

// Single source of truth for workflow vocabularies.
// The frontend mirrors these in frontend/src/constants/statuses.js — keep both in sync.

const INTERVIEW_STATUS = Object.freeze({
  PLAN_NEEDED: 'plan_needed',
  PLAN_READY: 'plan_ready',
  PLAN_APPROVED: 'plan_approved',
  TRANSCRIPT_SUBMITTED: 'transcript_submitted',
  REPORT_READY: 'report_ready',
  DECIDED: 'decided',
})

const CANDIDATE_STAGES = Object.freeze([
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
])

// Values written by older versions of the app.
const STAGE_ALIASES = Object.freeze({
  selected: 'Hired',
  dropped: 'Rejected',
})

function normalizeCandidateStage(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Screening'
  const key = value.trim().toLowerCase()
  if (STAGE_ALIASES[key]) return STAGE_ALIASES[key]
  return CANDIDATE_STAGES.find(stage => stage.toLowerCase() === key) || value.trim()
}

const PRE_INTERVIEW_STAGES = new Set(['Screening', 'Resume Reviewed', 'JD Matched', 'Shortlisted'])

const DECISIONS = Object.freeze({
  offer: { label: 'Move to offer', candidateStage: 'Offer' },
  another: { label: 'Another interview', candidateStage: 'Interview Pending' },
  reject: { label: 'Do not progress', candidateStage: 'Rejected' },
})

/**
 * Stage a candidate should move to after a workflow event, or null to leave it unchanged.
 * Automatic moves only go forward; a recruiter's manual "Hired"/"Rejected" is never overridden
 * except by an explicit hiring decision.
 */
function nextCandidateStage(event, currentStage, decision) {
  const stage = normalizeCandidateStage(currentStage)

  if (event === 'advanced_to_interview') {
    return PRE_INTERVIEW_STAGES.has(stage) ? 'Interview Pending' : null
  }
  if (event === 'plan_approved') {
    return PRE_INTERVIEW_STAGES.has(stage) || stage === 'Interview Pending' ? 'Interview Ready' : null
  }
  if (event === 'decision') {
    const target = DECISIONS[decision]?.candidateStage
    return target && target !== stage ? target : null
  }
  return null
}

module.exports = {
  INTERVIEW_STATUS,
  CANDIDATE_STAGES,
  DECISIONS,
  normalizeCandidateStage,
  nextCandidateStage,
}
