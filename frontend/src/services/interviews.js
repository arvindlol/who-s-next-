import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { api } from './api.js'
import { callableErrorMessage } from './errorMessages.js'
import { timestampMs } from '../utils/format.js'

export const startInterviewPlan = (screeningId, candidateId) => api.startInterviewPlan({ screeningId, candidateId })
export const generateInterviewPlan = (interviewId, configuration, replaceApproved = false) =>
  api.generateInterviewPlan({ interviewId, configuration, replaceApproved })
export const updateInterviewPlan = (interviewId, planVersion, sections, replaceApproved = false) =>
  api.updateInterviewPlan({ interviewId, planVersion, sections, replaceApproved })
export const approveInterviewPlan = (interviewId, planVersion) => api.approveInterviewPlan({ interviewId, planVersion })
export const submitTranscript = input => api.submitTranscript(input)
export const generateFinalReport = interviewId => api.generateFinalReport({ interviewId })
export const saveHiringDecision = (interviewId, decision, reason) => api.saveHiringDecision({ interviewId, decision, reason })

export function interviewErrorMessage(error, fallback = 'Could not complete this interview step. Please try again.') {
  return callableErrorMessage(error, fallback)
}

/** Live single interview owned by the user; calls onMissing when absent or not theirs. */
export function subscribeToInterview(uid, interviewId, { onChange, onMissing, onError }) {
  return onSnapshot(
    doc(db, 'interviews', interviewId),
    snapshot => {
      if (!snapshot.exists() || snapshot.get('ownerId') !== uid) onMissing()
      else onChange({ id: snapshot.id, ...snapshot.data() })
    },
    onError,
  )
}

/** Live list of the user's interviews, most recently updated first. */
export function subscribeToInterviews(uid, onChange, onError) {
  return onSnapshot(
    query(collection(db, 'interviews'), where('ownerId', '==', uid)),
    snapshot => onChange(snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt))),
    onError,
  )
}

/** Key matching the backend's interview identity (one workspace per job + candidate). */
export const interviewKey = (jobId, candidateId) => `${jobId}:${candidateId}`

/** Map of `jobId:candidateId` → latest interview, for "already advanced" checks. */
export function latestInterviewsByCandidate(interviews) {
  const map = new Map()
  interviews.forEach(interview => {
    if (!interview.jobId || !interview.candidateId) return
    const key = interviewKey(interview.jobId, interview.candidateId)
    const existing = map.get(key)
    if (!existing || (interview.round || 1) > (existing.round || 1)) map.set(key, interview)
  })
  return map
}

export function subscribeToTranscript(interviewId, onChange, onError) {
  return onSnapshot(
    doc(db, 'interviewTranscripts', interviewId),
    snapshot => onChange(snapshot.exists() ? snapshot.data() : null),
    onError,
  )
}

export function subscribeToReport(interviewId, onChange, onError) {
  return onSnapshot(
    doc(db, 'interviewReports', interviewId),
    snapshot => onChange(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError,
  )
}

export function subscribeToReports(uid, onChange, onError) {
  return onSnapshot(
    query(collection(db, 'interviewReports'), where('ownerId', '==', uid), orderBy('generatedAt', 'desc')),
    snapshot => onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError,
  )
}
