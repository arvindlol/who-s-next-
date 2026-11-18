'use strict'

const { callable } = require('./callable')
const { AppError } = require('../lib/appError')
const { requireDocumentId, requireCandidateIds, requireClientDocumentId } = require('../lib/validation')
const { normalizeScreeningResult } = require('../lib/screening')
const { displayFileName } = require('../lib/storagePaths')
const { generateWithValidationRetry } = require('../lib/validationRetry')
const prompts = require('../lib/prompts')
const { MODELS, USE_GEMINI_MOCK, PROMPT_VERSIONS } = require('../config')
const { mockScreening } = require('../gemini/mock')
const { db, FieldValue, logger } = require('../services/firebase')
const { gemini, recordInvalidResponse } = require('../services/gemini')
const { ENCRYPTION_SECRET, getApiKey } = require('../services/keys')
const { enforceRateLimit } = require('../services/rateLimit')
const { loadOwnedJob, loadOwnedCandidates, downloadPdf } = require('../services/documents')

/**
 * Screens 1–5 candidates against a job description.
 * The client passes a pre-generated `reportId` so it can watch `stage` on that document while
 * this function runs. On success the report is `completed`; on failure the document is removed.
 */
const runScreening = callable('runScreening', {
  timeoutSeconds: 1800,
  memory: '1GiB',
  secrets: [ENCRYPTION_SECRET],
}, async (data, { uid }) => {
  const jobId = requireDocumentId(data.jobId, 'job ID')
  const candidateIds = requireCandidateIds(data.candidateIds)
  const reportId = requireClientDocumentId(data.reportId, 'report ID')

  await enforceRateLimit(uid, 'screening')

  const [job, candidates] = await Promise.all([
    loadOwnedJob(uid, jobId),
    loadOwnedCandidates(uid, candidateIds),
  ])
  const apiKey = await getApiKey(uid)
  const model = MODELS.screening

  const reportRef = db.collection('screeningReports').doc(reportId)
  await reportRef.create({
    schemaVersion: 2,
    ownerId: uid,
    status: 'running',
    stage: 'preparing',
    provider: 'gemini',
    model,
    jobId,
    jobTitle: job.title,
    candidateIds,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  const setStage = stage => reportRef.update({ stage, updatedAt: FieldValue.serverTimestamp() }).catch(() => {})
  let cleanup = async () => {}

  try {
    const [jobPdf, ...resumePdfs] = await Promise.all([
      downloadPdf(job.storagePath, 'The job description'),
      ...candidates.map(candidate => downloadPdf(candidate.resumePath, `${candidate.name}'s resume`)),
    ])

    await setStage('reading')
    const pdf = USE_GEMINI_MOCK
      ? { mode: 'mock', parts: [], cleanup: async () => {} }
      : await gemini.pdfParts({
        apiKey,
        uid,
        documents: [
          { label: 'Job description PDF:', contents: jobPdf.contents },
          ...candidates.map((candidate, index) => ({
            label: `Resume PDF for candidateId ${candidate.id} (${candidate.name}):`,
            contents: resumePdfs[index].contents,
          })),
        ],
      })
    cleanup = pdf.cleanup

    await setStage('analyzing')
    const task = prompts.buildScreeningTask({ jobTitle: job.title, additionalCriteria: job.additionalCriteria, candidates })
    const context = { jobId, reportId }

    const { value } = await generateWithValidationRetry({
      generate: correction => (USE_GEMINI_MOCK
        ? mockScreening(candidates)
        : gemini.generateJson({
          apiKey,
          model,
          systemInstruction: prompts.SCREENING_SYSTEM_INSTRUCTION,
          parts: [{ text: task + correction }, ...pdf.parts],
          schema: prompts.SCREENING_SCHEMA,
          operation: 'screening',
          uid,
          context,
          requestMetadata: {
            candidateCount: candidates.length,
            jobPdfBytes: jobPdf.sizeBytes,
            candidatePdfBytes: resumePdfs.reduce((total, file) => total + file.sizeBytes, 0),
            pdfTransport: pdf.mode,
          },
        })),
      normalize: raw => normalizeScreeningResult(raw, candidates),
      buildCorrection: prompts.correctionNote,
      onInvalid: (error, attempt) => recordInvalidResponse({ uid, operation: 'screening', model, context, message: error.message, attempt }),
    })

    await setStage('saving')
    const resumePathById = new Map(candidates.map(candidate => [candidate.id, candidate.resumePath]))
    const results = value.candidates.map(result => ({
      ...result,
      resumeName: displayFileName(resumePathById.get(result.candidateId), result.candidateId),
    }))

    await reportRef.update({
      status: 'completed',
      stage: 'completed',
      results,
      screeningSummary: value.screeningSummary,
      jobFilename: jobPdf.filename,
      promptVersion: PROMPT_VERSIONS.screening,
      pdfTransport: pdf.mode,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return { reportId, status: 'completed', results, screeningSummary: value.screeningSummary }
  } catch (error) {
    await reportRef.delete().catch(deleteError => {
      logger.warn('Failed screening report could not be removed.', { uid, reportId, error: deleteError?.code })
    })
    if (!(error instanceof AppError)) {
      logger.error('Screening failed unexpectedly.', { uid, jobId, error: error?.message?.slice(0, 300) })
    }
    throw error
  } finally {
    await cleanup()
  }
})

module.exports = { runScreening }
