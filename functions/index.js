'use strict'

// Who's Next — Cloud Functions entry point.
// Business logic lives in src/: pure modules in src/lib (unit-tested with `npm test`),
// Firebase-dependent services in src/services, and callable handlers in src/handlers.

const { validateGeminiKey } = require('./src/handlers/apiKey')
const { runScreening } = require('./src/handlers/screening')
const {
  startInterviewPlan,
  generateInterviewPlan,
  updateInterviewPlan,
  approveInterviewPlan,
} = require('./src/handlers/interviews')
const { submitTranscript, generateFinalReport, saveHiringDecision } = require('./src/handlers/reports')
const { deleteCandidate, deleteJob, deleteAccount, purgeDeletedCandidates } = require('./src/handlers/deletion')

module.exports = {
  validateGeminiKey,
  runScreening,
  startInterviewPlan,
  generateInterviewPlan,
  updateInterviewPlan,
  approveInterviewPlan,
  submitTranscript,
  generateFinalReport,
  saveHiringDecision,
  deleteCandidate,
  deleteJob,
  deleteAccount,
  purgeDeletedCandidates,
}
