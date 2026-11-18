'use strict'

const { callable } = require('./callable')
const { fail, AppError } = require('../lib/appError')
const {
  requireDocumentId,
  requireInterviewConfiguration,
  requirePositiveInteger,
} = require('../lib/validation')
const { uniqueTextItems } = require('../lib/text')
const { interviewDocumentId } = require('../lib/crypto')
const { normalizeInterviewPlan, applyPlanEdits } = require('../lib/plan')
const { generateWithValidationRetry } = require('../lib/validationRetry')
const { INTERVIEW_STATUS } = require('../lib/statuses')
const prompts = require('../lib/prompts')
const { MODELS, USE_GEMINI_MOCK, PROMPT_VERSIONS } = require('../config')
const { mockPlan } = require('../gemini/mock')
const { db, FieldValue, logger } = require('../services/firebase')
const { gemini, recordInvalidResponse } = require('../services/gemini')
const { ENCRYPTION_SECRET, getApiKey } = require('../services/keys')
const { enforceRateLimit } = require('../services/rateLimit')
const { loadOwnedJob, loadOwnedCandidates, downloadPdf } = require('../services/documents')
const { recordCandidateEvent } = require('../services/candidateEvents')

const GENERATION_LOCK_MS = 15 * 60 * 1000
const EDITABLE_STATUSES = new Set([INTERVIEW_STATUS.PLAN_NEEDED, INTERVIEW_STATUS.PLAN_READY, INTERVIEW_STATUS.PLAN_APPROVED])

function suggestedSeniority(...values) {
  const text = values.filter(Boolean).join(' ').toLowerCase()
  if (/\b(principal|staff|lead|senior|head|director|manager)\b/.test(text)) return 'Senior'
  if (/\b(junior|entry|graduate|trainee|intern|associate)\b/.test(text)) return 'Junior'
  return 'Mid'
}

function suggestedTopics(job, candidate, result) {
  return uniqueTextItems([
    result?.skills?.missingMandatory || [],
    result?.skills?.matched || [],
    result?.skills?.missingPreferred || [],
    job.additionalCriteria || [],
    candidate.skills || [],
  ], 8)
}

async function loadOwnedInterview(uid, interviewId) {
  const ref = db.collection('interviews').doc(interviewId)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('ownerId') !== uid) fail('permission-denied', 'This interview is unavailable.')
  return { ref, interview: { id: interviewId, ...snapshot.data() } }
}

/** Plans may change until a transcript is submitted; an approved plan only with explicit confirmation. */
function assertPlanCanChange(interview, replaceApproved) {
  if (!EDITABLE_STATUSES.has(interview.status || INTERVIEW_STATUS.PLAN_NEEDED)) {
    fail('failed-precondition', 'A transcript has already been added for this interview, so its plan can no longer change.')
  }
  if (interview.status === INTERVIEW_STATUS.PLAN_APPROVED && !replaceApproved) {
    fail('failed-precondition', 'This plan is already approved. Confirm that you want to replace the approved plan.')
  }
}

// ---------------------------------------------------------------------------
// startInterviewPlan — creates (or reuses) the interview workspace for a screened candidate
// ---------------------------------------------------------------------------
const startInterviewPlan = callable('startInterviewPlan', {}, async (data, { uid }) => {
  const screeningId = requireDocumentId(data.screeningId, 'screening report ID')
  const candidateId = requireDocumentId(data.candidateId, 'candidate ID')

  const screeningSnapshot = await db.collection('screeningReports').doc(screeningId).get()
  if (!screeningSnapshot.exists || screeningSnapshot.get('ownerId') !== uid) {
    fail('permission-denied', 'The screening report is unavailable.')
  }
  const screening = screeningSnapshot.data()
  if ((screening.status || 'completed') !== 'completed') fail('failed-precondition', 'This screening has not finished yet.')

  const result = (screening.results || []).find(item => item.candidateId === candidateId)
  if (!result) fail('failed-precondition', 'This candidate is not part of the screening report.')

  const jobId = requireDocumentId(screening.jobId, 'job ID')
  const [job, [candidate]] = await Promise.all([
    loadOwnedJob(uid, jobId, { requireReady: false }),
    loadOwnedCandidates(uid, [candidateId], { requireResume: false }),
  ])

  const existing = await db.collection('interviews')
    .where('ownerId', '==', uid)
    .where('candidateId', '==', candidateId)
    .get()
  const rounds = existing.docs
    .filter(doc => doc.get('jobId') === jobId)
    .sort((first, second) => (second.get('round') || 1) - (first.get('round') || 1))
  const latest = rounds[0]

  const anotherRoundRequested = latest
    && latest.get('status') === INTERVIEW_STATUS.DECIDED
    && latest.get('decision') === 'another'

  if (latest && !anotherRoundRequested) {
    // Keep the workspace linked to the newest screening while the plan is still being prepared.
    const status = latest.get('status')
    if ((status === INTERVIEW_STATUS.PLAN_NEEDED || status === INTERVIEW_STATUS.PLAN_READY)
      && latest.get('screeningReportId') !== screeningId) {
      await latest.ref.update({
        screeningReportId: screeningId,
        screeningScore: Number(result.matchScore || 0),
        screeningRecommendation: result.recommendation || '',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    return { interviewId: latest.id, created: false }
  }

  const round = latest ? (latest.get('round') || 1) + 1 : 1
  const interviewId = interviewDocumentId(uid, jobId, candidateId, round)
  const ref = db.collection('interviews').doc(interviewId)

  const created = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (snapshot.exists) {
      if (snapshot.get('ownerId') !== uid) fail('permission-denied', 'This interview is unavailable.')
      return false
    }
    transaction.create(ref, {
      schemaVersion: 2,
      ownerId: uid,
      candidateId,
      candidateName: candidate.name || result.candidateName || 'Unnamed candidate',
      role: candidate.role || job.title,
      jobId,
      jobTitle: job.title,
      round,
      screeningReportId: screeningId,
      screeningScore: Number(result.matchScore || 0),
      screeningRecommendation: result.recommendation || '',
      status: INTERVIEW_STATUS.PLAN_NEEDED,
      currentStep: 1,
      settings: {
        lengthMinutes: 45,
        seniority: suggestedSeniority(job.title, candidate.role),
        questionTypes: ['role_skill', 'situational', 'behavioural'],
        topics: suggestedTopics(job, candidate, result),
        additionalInstructions: '',
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  })

  if (created) {
    await recordCandidateEvent(uid, candidateId, {
      event: 'advanced_to_interview',
      text: `Advanced to interview for ${job.title}${round > 1 ? ` (round ${round})` : ''}.`,
    })
  }

  return { interviewId, created }
})

// ---------------------------------------------------------------------------
// generateInterviewPlan
// ---------------------------------------------------------------------------
const generateInterviewPlan = callable('generateInterviewPlan', {
  timeoutSeconds: 900,
  memory: '512MiB',
  secrets: [ENCRYPTION_SECRET],
}, async (data, { uid }) => {
  const interviewId = requireDocumentId(data.interviewId, 'interview ID')
  const configuration = requireInterviewConfiguration(data.configuration)
  const replaceApproved = data.replaceApproved === true

  const { ref, interview } = await loadOwnedInterview(uid, interviewId)
  assertPlanCanChange(interview, replaceApproved)
  await enforceRateLimit(uid, 'interviewPlan')

  // Lock so two clicks (or two tabs) cannot generate competing versions.
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    const generation = snapshot.get('planGeneration')
    const startedAt = generation?.startedAt?.toMillis?.() || 0
    if (generation?.status === 'running' && Date.now() - startedAt < GENERATION_LOCK_MS) {
      fail('failed-precondition', 'A plan is already being generated for this interview. Please wait for it to finish.')
    }
    transaction.update(ref, {
      planGeneration: { status: 'running', stage: 'preparing', startedAt: FieldValue.serverTimestamp() },
    })
  })

  const setStage = stage => ref.update({ 'planGeneration.stage': stage }).catch(() => {})
  let cleanup = async () => {}
  const model = MODELS.interview

  try {
    const screeningSnapshot = interview.screeningReportId
      ? await db.collection('screeningReports').doc(interview.screeningReportId).get()
      : null
    const screeningResult = screeningSnapshot?.exists && screeningSnapshot.get('ownerId') === uid
      ? (screeningSnapshot.get('results') || []).find(result => result.candidateId === interview.candidateId) || null
      : null

    const [job, [candidate]] = await Promise.all([
      loadOwnedJob(uid, interview.jobId),
      loadOwnedCandidates(uid, [interview.candidateId]),
    ])
    const apiKey = await getApiKey(uid)
    const [jobPdf, resumePdf] = await Promise.all([
      downloadPdf(job.storagePath, 'The job description'),
      downloadPdf(candidate.resumePath, `${candidate.name}'s resume`),
    ])

    await setStage('reading')
    const pdf = USE_GEMINI_MOCK
      ? { mode: 'mock', parts: [], cleanup: async () => {} }
      : await gemini.pdfParts({
        apiKey,
        uid,
        documents: [
          { label: 'Job description PDF:', contents: jobPdf.contents },
          { label: 'Candidate resume PDF:', contents: resumePdf.contents },
        ],
      })
    cleanup = pdf.cleanup

    await setStage('generating')
    const task = prompts.buildPlanTask({ interview, configuration, screeningResult })
    const context = { interviewId, jobId: interview.jobId }

    const { value: generated } = await generateWithValidationRetry({
      generate: correction => (USE_GEMINI_MOCK
        ? mockPlan(configuration, interview.candidateName)
        : gemini.generateJson({
          apiKey,
          model,
          systemInstruction: prompts.PLAN_SYSTEM_INSTRUCTION,
          parts: [{ text: task + correction }, ...pdf.parts],
          schema: prompts.PLAN_SCHEMA,
          operation: 'interview_plan',
          uid,
          context,
          requestMetadata: { jobPdfBytes: jobPdf.sizeBytes, candidatePdfBytes: resumePdf.sizeBytes, pdfTransport: pdf.mode },
        })),
      normalize: raw => normalizeInterviewPlan(raw, configuration, { candidateName: interview.candidateName }),
      buildCorrection: prompts.correctionNote,
      onInvalid: (error, attempt) => recordInvalidResponse({ uid, operation: 'interview_plan', model, context, message: error.message, attempt }),
    })

    const plan = { ...generated, provider: 'gemini', model, promptVersion: PROMPT_VERSIONS.interviewPlan, edited: false }

    const planVersion = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref)
      const current = snapshot.data()
      // Re-check: the status may have moved on (e.g. transcript added) while Gemini was working.
      assertPlanCanChange(current, replaceApproved)
      const nextVersion = Number(current.planVersion || 0) + 1
      transaction.update(ref, {
        settings: configuration,
        plan,
        planVersion: nextVersion,
        status: INTERVIEW_STATUS.PLAN_READY,
        currentStep: 2,
        approvedAt: null,
        approvedBy: null,
        approvedPlanVersion: null,
        planGeneration: FieldValue.delete(),
        generatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return nextVersion
    })

    return { interviewId, planVersion, status: INTERVIEW_STATUS.PLAN_READY }
  } catch (error) {
    await ref.update({
      planGeneration: {
        status: 'failed',
        message: error instanceof AppError ? error.message : 'The plan could not be generated.',
        finishedAt: FieldValue.serverTimestamp(),
      },
    }).catch(() => {})
    if (!(error instanceof AppError)) logger.error('Plan generation failed unexpectedly.', { uid, interviewId, error: error?.message?.slice(0, 300) })
    throw error
  } finally {
    await cleanup()
  }
})

// ---------------------------------------------------------------------------
// updateInterviewPlan — recruiter edits before approval
// ---------------------------------------------------------------------------
const updateInterviewPlan = callable('updateInterviewPlan', {}, async (data, { uid }) => {
  const interviewId = requireDocumentId(data.interviewId, 'interview ID')
  const planVersion = requirePositiveInteger(data.planVersion, 'plan version')
  const replaceApproved = data.replaceApproved === true
  const ref = db.collection('interviews').doc(interviewId)

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists || snapshot.get('ownerId') !== uid) fail('permission-denied', 'This interview is unavailable.')
    const interview = snapshot.data()
    assertPlanCanChange(interview, replaceApproved)

    if (Number(interview.planVersion || 0) !== planVersion) {
      fail('failed-precondition', 'This plan changed since you opened it. Reload the page and apply your edits again.')
    }
    if (!Array.isArray(interview.plan?.sections)) fail('failed-precondition', 'Generate a plan before editing it.')

    const updatedPlan = applyPlanEdits(interview.plan, data.sections, interview.settings?.topics || [])
    const nextVersion = planVersion + 1

    transaction.update(ref, {
      plan: {
        ...interview.plan,
        ...updatedPlan,
        edited: true,
        editedAt: FieldValue.serverTimestamp(),
        editedBy: uid,
      },
      planVersion: nextVersion,
      status: INTERVIEW_STATUS.PLAN_READY,
      currentStep: 2,
      approvedAt: null,
      approvedBy: null,
      approvedPlanVersion: null,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return { interviewId, planVersion: nextVersion, status: INTERVIEW_STATUS.PLAN_READY, allTopicsCovered: updatedPlan.allTopicsCovered }
  })
})

// ---------------------------------------------------------------------------
// approveInterviewPlan
// ---------------------------------------------------------------------------
const approveInterviewPlan = callable('approveInterviewPlan', {}, async (data, { uid }) => {
  const interviewId = requireDocumentId(data.interviewId, 'interview ID')
  const planVersion = requirePositiveInteger(data.planVersion, 'plan version')
  const ref = db.collection('interviews').doc(interviewId)

  const result = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists || snapshot.get('ownerId') !== uid) fail('permission-denied', 'This interview is unavailable.')
    const interview = snapshot.data()

    const hasQuestions = (interview.plan?.sections || []).some(section => (section.questions || []).length > 0)
    if (!hasQuestions) fail('failed-precondition', 'Generate an interview plan before approving it.')
    if (Number(interview.planVersion || 0) !== planVersion) {
      fail('failed-precondition', 'This plan changed since you opened it. Review the latest version before approving.')
    }
    if (Number(interview.approvedPlanVersion || 0) === planVersion && interview.approvedAt) {
      return { interviewId, planVersion, status: interview.status, alreadyApproved: true, candidateId: interview.candidateId }
    }
    if (interview.status !== INTERVIEW_STATUS.PLAN_READY) {
      fail('failed-precondition', 'This interview plan is not ready for approval.')
    }

    transaction.update(ref, {
      status: INTERVIEW_STATUS.PLAN_APPROVED,
      currentStep: 3,
      approvedPlanVersion: planVersion,
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { interviewId, planVersion, status: INTERVIEW_STATUS.PLAN_APPROVED, alreadyApproved: false, candidateId: interview.candidateId }
  })

  if (!result.alreadyApproved) {
    await recordCandidateEvent(uid, result.candidateId, { event: 'plan_approved', text: `Interview plan v${planVersion} approved.` })
  }
  const { candidateId, ...response } = result
  return response
})

module.exports = { startInterviewPlan, generateInterviewPlan, updateInterviewPlan, approveInterviewPlan }
