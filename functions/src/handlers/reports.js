'use strict'

const { callable } = require('./callable')
const { fail, AppError } = require('../lib/appError')
const { requireDocumentId, requireTranscriptInput, requireDecisionInput } = require('../lib/validation')
const { redactContactDetails } = require('../lib/redact')
const { normalizeFinalReport } = require('../lib/report')
const { generateWithValidationRetry } = require('../lib/validationRetry')
const { INTERVIEW_STATUS, DECISIONS } = require('../lib/statuses')
const prompts = require('../lib/prompts')
const { MODELS, USE_GEMINI_MOCK, PROMPT_VERSIONS } = require('../config')
const { mockReport } = require('../gemini/mock')
const { db, FieldValue, Timestamp, logger } = require('../services/firebase')
const { gemini, recordInvalidResponse } = require('../services/gemini')
const { ENCRYPTION_SECRET, getApiKey } = require('../services/keys')
const { enforceRateLimit } = require('../services/rateLimit')
const { recordCandidateEvent } = require('../services/candidateEvents')

const GENERATION_LOCK_MS = 10 * 60 * 1000
const TRANSCRIPT_STATUSES = new Set([
  INTERVIEW_STATUS.PLAN_APPROVED,
  INTERVIEW_STATUS.TRANSCRIPT_SUBMITTED,
  INTERVIEW_STATUS.REPORT_READY,
])

// ---------------------------------------------------------------------------
// submitTranscript — stores the (optionally redacted) transcript of an approved interview
// ---------------------------------------------------------------------------
const submitTranscript = callable('submitTranscript', {}, async (data, { uid }) => {
  const interviewId = requireDocumentId(data.interviewId, 'interview ID')
  const input = requireTranscriptInput(data)
  const interviewRef = db.collection('interviews').doc(interviewId)
  const transcriptRef = db.collection('interviewTranscripts').doc(interviewId)
  const reportRef = db.collection('interviewReports').doc(interviewId)

  const redaction = input.redactContacts
    ? redactContactDetails(input.transcript)
    : { text: input.transcript, emails: 0, phones: 0 }
  const notes = input.redactContacts ? redactContactDetails(input.notes).text : input.notes

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(interviewRef)
    if (!snapshot.exists || snapshot.get('ownerId') !== uid) fail('permission-denied', 'This interview is unavailable.')
    const interview = snapshot.data()

    if (interview.status === INTERVIEW_STATUS.DECIDED) {
      fail('failed-precondition', 'A hiring decision has already been recorded for this interview.')
    }
    if (!TRANSCRIPT_STATUSES.has(interview.status)) {
      fail('failed-precondition', 'Approve the interview plan before adding the transcript.')
    }

    transaction.set(transcriptRef, {
      schemaVersion: 1,
      ownerId: uid,
      interviewId,
      candidateId: interview.candidateId,
      transcript: redaction.text,
      speakerRoles: input.speakerRoles,
      notes,
      redacted: input.redactContacts,
      redactions: { emails: redaction.emails, phones: redaction.phones },
      planVersion: interview.planVersion,
      characterCount: redaction.text.length,
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // A new transcript makes any earlier report out of date.
    transaction.delete(reportRef)
    transaction.update(interviewRef, {
      status: INTERVIEW_STATUS.TRANSCRIPT_SUBMITTED,
      currentStep: 4,
      transcriptSubmittedAt: FieldValue.serverTimestamp(),
      reportGeneration: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  return {
    interviewId,
    status: INTERVIEW_STATUS.TRANSCRIPT_SUBMITTED,
    redactions: { emails: redaction.emails, phones: redaction.phones },
  }
})

// ---------------------------------------------------------------------------
// generateFinalReport — evaluates the transcript against the approved plan
// ---------------------------------------------------------------------------
const generateFinalReport = callable('generateFinalReport', {
  timeoutSeconds: 600,
  memory: '512MiB',
  secrets: [ENCRYPTION_SECRET],
}, async (data, { uid }) => {
  const interviewId = requireDocumentId(data.interviewId, 'interview ID')
  const interviewRef = db.collection('interviews').doc(interviewId)

  const interviewSnapshot = await interviewRef.get()
  if (!interviewSnapshot.exists || interviewSnapshot.get('ownerId') !== uid) {
    fail('permission-denied', 'This interview is unavailable.')
  }
  const interview = { id: interviewId, ...interviewSnapshot.data() }
  if (![INTERVIEW_STATUS.TRANSCRIPT_SUBMITTED, INTERVIEW_STATUS.REPORT_READY].includes(interview.status)) {
    fail('failed-precondition', 'Add the interview transcript before generating the report.')
  }
  if (Number(interview.approvedPlanVersion || 0) !== Number(interview.planVersion || 0)) {
    fail('failed-precondition', 'The interview plan is no longer the approved version.')
  }

  const transcriptSnapshot = await db.collection('interviewTranscripts').doc(interviewId).get()
  if (!transcriptSnapshot.exists || transcriptSnapshot.get('ownerId') !== uid) {
    fail('failed-precondition', 'The transcript for this interview is missing. Add it again.')
  }
  const transcript = transcriptSnapshot.data()

  await enforceRateLimit(uid, 'finalReport')

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(interviewRef)
    const generation = snapshot.get('reportGeneration')
    const startedAt = generation?.startedAt?.toMillis?.() || 0
    if (generation?.status === 'running' && Date.now() - startedAt < GENERATION_LOCK_MS) {
      fail('failed-precondition', 'The report is already being generated. Please wait for it to finish.')
    }
    transaction.update(interviewRef, { reportGeneration: { status: 'running', startedAt: FieldValue.serverTimestamp() } })
  })

  const model = MODELS.report
  try {
    const apiKey = await getApiKey(uid)
    const task = prompts.buildReportTask({
      interview,
      plan: interview.plan,
      transcript: transcript.transcript,
      speakerRoles: transcript.speakerRoles || {},
      notes: transcript.notes,
    })
    const context = { interviewId }

    const { value: report } = await generateWithValidationRetry({
      generate: correction => (USE_GEMINI_MOCK
        ? mockReport(interview.plan, transcript.transcript)
        : gemini.generateJson({
          apiKey,
          model,
          systemInstruction: prompts.REPORT_SYSTEM_INSTRUCTION,
          parts: [{ text: task + correction }],
          schema: prompts.REPORT_SCHEMA,
          operation: 'final_report',
          uid,
          context,
          requestMetadata: { transcriptChars: transcript.transcript.length },
        })),
      normalize: raw => normalizeFinalReport(raw, interview.plan, transcript.transcript),
      buildCorrection: prompts.correctionNote,
      onInvalid: (error, attempt) => recordInvalidResponse({ uid, operation: 'final_report', model, context, message: error.message, attempt }),
    })

    const batch = db.batch()
    batch.set(db.collection('interviewReports').doc(interviewId), {
      ...report,
      ownerId: uid,
      interviewId,
      candidateId: interview.candidateId,
      candidateName: interview.candidateName,
      role: interview.role || interview.jobTitle,
      jobId: interview.jobId,
      jobTitle: interview.jobTitle,
      round: interview.round || 1,
      planVersion: interview.planVersion,
      interviewedAt: transcript.submittedAt || null,
      provider: 'gemini',
      model,
      promptVersion: PROMPT_VERSIONS.finalReport,
      decision: null,
      decisionHistory: [],
      generatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    batch.update(interviewRef, {
      status: INTERVIEW_STATUS.REPORT_READY,
      currentStep: 5,
      reportGeneration: FieldValue.delete(),
      reportGeneratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    return { interviewId, status: INTERVIEW_STATUS.REPORT_READY }
  } catch (error) {
    await interviewRef.update({
      reportGeneration: {
        status: 'failed',
        message: error instanceof AppError ? error.message : 'The report could not be generated.',
        finishedAt: FieldValue.serverTimestamp(),
      },
    }).catch(() => {})
    if (!(error instanceof AppError)) logger.error('Report generation failed unexpectedly.', { uid, interviewId, error: error?.message?.slice(0, 300) })
    throw error
  }
})

// ---------------------------------------------------------------------------
// saveHiringDecision — the recruiter's decision, kept with a history
// ---------------------------------------------------------------------------
const saveHiringDecision = callable('saveHiringDecision', {}, async (data, { uid, token }) => {
  const interviewId = requireDocumentId(data.interviewId, 'interview ID')
  const { decision, reason } = requireDecisionInput(data)
  const interviewRef = db.collection('interviews').doc(interviewId)
  const reportRef = db.collection('interviewReports').doc(interviewId)
  const decidedByName = String(token.name || token.email || 'Recruiter').slice(0, 120)

  const result = await db.runTransaction(async transaction => {
    const [interviewSnapshot, reportSnapshot] = await Promise.all([transaction.get(interviewRef), transaction.get(reportRef)])
    if (!interviewSnapshot.exists || interviewSnapshot.get('ownerId') !== uid) fail('permission-denied', 'This interview is unavailable.')
    if (!reportSnapshot.exists) fail('failed-precondition', 'Generate the final report before recording a decision.')

    const status = interviewSnapshot.get('status')
    if (![INTERVIEW_STATUS.REPORT_READY, INTERVIEW_STATUS.DECIDED].includes(status)) {
      fail('failed-precondition', 'This interview is not ready for a decision.')
    }

    const previous = reportSnapshot.get('decision')
    const entry = {
      value: decision,
      label: DECISIONS[decision].label,
      reason,
      decidedBy: uid,
      decidedByName,
    }

    transaction.update(reportRef, {
      decision: { ...entry, decidedAt: FieldValue.serverTimestamp() },
      decisionHistory: FieldValue.arrayUnion({ ...entry, decidedAt: Timestamp.now() }),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.update(interviewRef, {
      status: INTERVIEW_STATUS.DECIDED,
      decision,
      decidedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return {
      candidateId: interviewSnapshot.get('candidateId'),
      changed: previous?.value !== decision || previous?.reason !== reason,
    }
  })

  if (result.changed) {
    await recordCandidateEvent(uid, result.candidateId, {
      event: 'decision',
      decision,
      text: `Decision recorded: ${DECISIONS[decision].label}.`,
    })
  }

  return { interviewId, status: INTERVIEW_STATUS.DECIDED, decision }
})

module.exports = { submitTranscript, generateFinalReport, saveHiringDecision }
