import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase.js'

// Client timeouts are a little longer than each function's server timeout.
function callable(name, timeout) {
  const fn = httpsCallable(functions, name, timeout ? { timeout } : undefined)
  return async (data = {}) => (await fn(data)).data
}

export const api = {
  geminiKey: callable('validateGeminiKey', 30_000),
  runScreening: callable('runScreening', 1_860_000),
  startInterviewPlan: callable('startInterviewPlan', 70_000),
  generateInterviewPlan: callable('generateInterviewPlan', 960_000),
  updateInterviewPlan: callable('updateInterviewPlan', 70_000),
  approveInterviewPlan: callable('approveInterviewPlan', 70_000),
  submitTranscript: callable('submitTranscript', 70_000),
  generateFinalReport: callable('generateFinalReport', 660_000),
  saveHiringDecision: callable('saveHiringDecision', 70_000),
  deleteCandidate: callable('deleteCandidate', 320_000),
  deleteJob: callable('deleteJob', 320_000),
  deleteAccount: callable('deleteAccount', 560_000),
}
