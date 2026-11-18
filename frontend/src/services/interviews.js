import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase.js'

const startInterviewPlanCall = httpsCallable(functions, 'startInterviewPlan')
const generateInterviewPlanCall = httpsCallable(functions, 'generateInterviewPlan', {
  timeout: 3_600_000,
})
const approveInterviewPlanCall = httpsCallable(functions, 'approveInterviewPlan')
const saveInterviewTranscriptCall = httpsCallable(functions, 'saveInterviewTranscript')
const generateInterviewReportCall = httpsCallable(functions, 'generateInterviewReport', {
  timeout: 3_600_000,
})
const recordInterviewDecisionCall = httpsCallable(functions, 'recordInterviewDecision')

export async function startInterviewPlan(screeningId, candidateId) {
  const response = await startInterviewPlanCall({ screeningId, candidateId })
  return response.data
}

export async function generateInterviewPlan(interviewId, configuration) {
  const response = await generateInterviewPlanCall({ interviewId, configuration })
  return response.data
}

export async function approveInterviewPlan(interviewId, planVersion) {
  const response = await approveInterviewPlanCall({ interviewId, planVersion })
  return response.data
}

export async function saveInterviewTranscript(interviewId, transcriptData) {
  const response = await saveInterviewTranscriptCall({ interviewId, ...transcriptData })
  return response.data
}

export async function generateInterviewReport(interviewId) {
  const response = await generateInterviewReportCall({ interviewId })
  return response.data
}

export async function recordInterviewDecision(interviewId, decision, note) {
  const response = await recordInterviewDecisionCall({ interviewId, decision, note })
  return response.data
}

export function interviewErrorMessage(error, fallback = 'Could not prepare this interview. Please try again.') {
  const code = String(error?.code || '').replace('functions/', '')
  if (code === 'not-found') {
    return 'The interview service is not deployed yet. Deploy the new Firebase interview functions and try again.'
  }
  if (code === 'failed-precondition' || code === 'invalid-argument' || code === 'permission-denied') {
    return error?.message || fallback
  }
  if (code === 'deadline-exceeded') return 'The request took too long. Please try again.'
  if (code === 'already-exists') return error?.message || 'This report is already being generated.'
  if (code === 'resource-exhausted') return 'Gemini quota is unavailable right now. Check your API key quota and try again.'
  if (code === 'unavailable') return error?.message || 'Gemini is temporarily unavailable. Please try again.'
  if (code === 'data-loss' || code === 'internal') return error?.message || fallback
  return fallback
}
