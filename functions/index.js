const crypto = require('node:crypto')
const { initializeApp } = require('firebase-admin/app')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { logger } = require('firebase-functions')
const { HttpsError, onCall } = require('firebase-functions/v2/https')

initializeApp()

const db = getFirestore()
const GEMINI_MODELS_URL =
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
const GEMINI_SCREENING_MODEL = 'gemini-3.8-flash'
const GEMINI_INTERVIEW_MODEL = 'gemini-3.7-flash'
const INTERVIEW_PLAN_PROMPT_VERSION = 'interview-plan-structured-v3'
const INTERVIEW_REPORT_PROMPT_VERSION = 'interview-report-structured-v2'
const REQUEST_TIMEOUT_MS = 10_000
const GEMINI_GENERATION_TIMEOUT_MS = 90_000
const GEMINI_MAX_ATTEMPTS = 4
const GEMINI_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]
const GEMINI_RETRYABLE_STATUSES = new Set([500, 502, 503, 504])
const MAX_PDF_BYTES = 10 * 1024 * 1024
const FUNCTION_OPTIONS = {
  region: 'asia-south1',
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 10,
  invoker: 'public',
}
const SCREENING_FUNCTION_OPTIONS = {
  ...FUNCTION_OPTIONS,
  timeoutSeconds: 3_600,
  memory: '512MiB',
}
const INTERVIEW_LENGTHS = {
  30: { questionCount: 8 },
  45: { questionCount: 11 },
  60: { questionCount: 15 },
}
const INTERVIEW_SENIORITIES = new Set(['Junior', 'Mid', 'Senior'])
const INTERVIEW_QUESTION_TYPES = new Set([
  'role_skill',
  'situational',
  'behavioural',
  'knowledge',
  'values',
])
const LEGACY_INTERVIEW_QUESTION_TYPES = {
  role_skills: 'role_skill',
  behavioral: 'behavioural',
  work_approach: 'values',
}
const INTERVIEW_REPORT_DECISIONS = new Set([
  'Move to offer',
  'Move to next stage',
  'Another interview',
  'Do not progress',
])

function requireSignedIn(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in before managing an API key.')
  }

  return request.auth.uid
}

function requireApiKey(value) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'A Gemini API key is required.')
  }

  const apiKey = value.trim()
  if (!apiKey || apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
    throw new HttpsError('invalid-argument', 'Enter a complete Gemini API key.')
  }

  return apiKey
}

function requireDocumentId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
    throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  }

  return value.trim()
}

function requireCandidateIds(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw new HttpsError('invalid-argument', 'Select between 2 and 3 candidates.')
  }

  const candidateIds = value.map(candidateId => requireDocumentId(candidateId, 'candidate ID'))
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new HttpsError('invalid-argument', 'Each selected candidate must be unique.')
  }

  return candidateIds
}

function uniqueTextItems(values, maximum = 8) {
  const seen = new Set()
  const items = []

  for (const value of values.flat()) {
    if (typeof value !== 'string') continue
    const text = value.trim().replace(/\s+/g, ' ')
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    items.push(text.slice(0, 180))
    if (items.length >= maximum) break
  }

  return items
}

function suggestedSeniority(...values) {
  const text = values.filter(Boolean).join(' ').toLowerCase()
  if (/\b(principal|staff|lead|senior|head|director|manager)\b/.test(text)) return 'Senior'
  if (/\b(junior|entry|graduate|trainee|intern|associate)\b/.test(text)) return 'Junior'
  return 'Mid'
}

function interviewDocumentId(uid, jobId, candidateId) {
  return crypto.createHash('sha256').update(`${uid}:${jobId}:${candidateId}`).digest('hex').slice(0, 32)
}

function interviewTopics(job, candidate, result) {
  const criteria = Array.isArray(job.additionalCriteria)
    ? job.additionalCriteria
    : [job.additionalCriteria]

  return uniqueTextItems([
    result?.skills?.missingMandatory || [],
    result?.skills?.matched || [],
    result?.skills?.missingPreferred || [],
    criteria,
    candidate.skills || [],
  ])
}

function requireInterviewConfiguration(value) {
  const lengthMinutes = Number(value?.lengthMinutes)
  if (!INTERVIEW_LENGTHS[lengthMinutes]) {
    throw new HttpsError('invalid-argument', 'Choose a 30, 45, or 60 minute interview.')
  }

  const seniority = typeof value?.seniority === 'string' ? value.seniority.trim() : ''
  if (!INTERVIEW_SENIORITIES.has(seniority)) {
    throw new HttpsError('invalid-argument', 'Choose Junior, Mid, or Senior.')
  }

  const questionTypes = Array.isArray(value?.questionTypes)
    ? [...new Set(value.questionTypes.map(type => LEGACY_INTERVIEW_QUESTION_TYPES[type] || type))]
    : []
  if (
    questionTypes.length === 0
    || questionTypes.some(type => !INTERVIEW_QUESTION_TYPES.has(type))
  ) {
    throw new HttpsError('invalid-argument', 'Select at least one supported question type.')
  }

  const topics = uniqueTextItems(Array.isArray(value?.topics) ? value.topics : [], 12)
  if (topics.length === 0) {
    throw new HttpsError('invalid-argument', 'Add at least one job-related interview topic.')
  }
  if (topics.length > INTERVIEW_LENGTHS[lengthMinutes].questionCount) {
    throw new HttpsError(
      'invalid-argument',
      `Choose no more than ${INTERVIEW_LENGTHS[lengthMinutes].questionCount} topics for this interview length.`,
    )
  }

  const additionalInstructions = typeof value?.additionalInstructions === 'string'
    ? value.additionalInstructions.trim().slice(0, 1500)
    : ''

  return { lengthMinutes, seniority, questionTypes, topics, additionalInstructions }
}

function candidateResumeStoragePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('failed-precondition', 'The selected candidate has no uploaded resume.')
  }

  const resume = value.trim()
  if (!resume.startsWith('http://') && !resume.startsWith('https://')) {
    return resume
  }

  try {
    const url = new URL(resume)
    const encodedPath = url.pathname.split('/o/')[1]
    if (!encodedPath) throw new Error('Missing Storage object path')
    return decodeURIComponent(encodedPath)
  } catch {
    throw new HttpsError(
      'failed-precondition',
      'The selected candidate resume has an invalid Storage location.',
    )
  }
}

async function downloadPdf(storagePath, label) {
  const file = getStorage().bucket().file(storagePath)

  try {
    const [[contents], [metadata]] = await Promise.all([
      file.download(),
      file.getMetadata(),
    ])

    if (contents.length === 0 || contents.length > MAX_PDF_BYTES) {
      throw new HttpsError(
        'failed-precondition',
        `${label} must be a non-empty PDF no larger than 10 MB.`,
      )
    }

    if (contents.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new HttpsError(
        'failed-precondition',
        `${label} must be uploaded as a PDF for the first screening test.`,
      )
    }

    return {
      contents,
      filename: storagePath.split('/').pop() || `${label}.pdf`,
      contentType: metadata.contentType || 'application/pdf',
      sizeBytes: contents.length,
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error

    logger.error('Screening PDF download failed.', {
      label,
      error: error?.code || error?.name || 'UnknownError',
    })

    throw new HttpsError(
      'not-found',
      `${label} could not be downloaded from Firebase Storage.`,
    )
  }
}

async function loadOwnedScreeningPdfs(uid, jobId, candidateIds) {
  const [jobSnapshot, ...candidateSnapshots] = await Promise.all([
    db.collection('jobs').doc(jobId).get(),
    ...candidateIds.map(candidateId => db.collection('candidates').doc(candidateId).get()),
  ])

  if (!jobSnapshot.exists || jobSnapshot.get('ownerId') !== uid) {
    throw new HttpsError('permission-denied', 'The selected job is unavailable.')
  }

  const job = jobSnapshot.data()
  const jobStoragePath = typeof job.storagePath === 'string' ? job.storagePath.trim() : ''
  const candidates = candidateSnapshots.map((snapshot, index) => {
    if (!snapshot.exists || snapshot.get('ownerId') !== uid) {
      throw new HttpsError('permission-denied', 'One of the selected candidates is unavailable.')
    }

    const candidateId = candidateIds[index]
    const candidate = snapshot.data()
    const resumeStoragePath = candidateResumeStoragePath(candidate.resume)

    if (!resumeStoragePath.startsWith(`resumes/${uid}/${candidateId}-`)) {
      throw new HttpsError('permission-denied', 'A selected resume file location is invalid.')
    }

    return {
      id: candidateId,
      name: candidate.name || 'Unnamed candidate',
      resumeStoragePath,
    }
  })

  if (job.status !== 'ready' || !jobStoragePath) {
    throw new HttpsError('failed-precondition', 'The selected job PDF is not ready.')
  }

  if (!jobStoragePath.startsWith(`users/${uid}/jobs/${jobId}/`)) {
    throw new HttpsError('permission-denied', 'The selected job file location is invalid.')
  }

  const [jobPdf, ...resumePdfs] = await Promise.all([
    downloadPdf(jobStoragePath, 'Job description'),
    ...candidates.map((candidate, index) => (
      downloadPdf(candidate.resumeStoragePath, `Candidate resume ${index + 1}`)
    )),
  ])

  return {
    job: {
      id: jobId,
      title: job.title || 'Untitled job',
      ...jobPdf,
    },
    candidates: candidates.map((candidate, index) => ({
      id: candidate.id,
      name: candidate.name,
      ...resumePdfs[index],
    })),
  }
}

function parseGeminiJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    return JSON.parse(cleaned)
  } catch {
    throw new HttpsError(
      'data-loss',
      'Gemini returned an unreadable test response. Please try again.',
    )
  }
}

function invalidScreeningResult(message = 'Gemini returned an invalid screening result.') {
  throw new HttpsError('data-loss', message)
}

function requiredText(value) {
  if (typeof value !== 'string' || !value.trim()) invalidScreeningResult()
  return value.trim()
}

function textList(value) {
  if (!Array.isArray(value)) invalidScreeningResult()
  return value.map(requiredText)
}

function integerInRange(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalidScreeningResult()
  }
  return value
}

function matchLevelForScore(score) {
  if (score >= 90) return 'Excellent Match'
  if (score >= 75) return 'Strong Match'
  if (score >= 60) return 'Moderate Match'
  if (score >= 40) return 'Weak Match'
  return 'Poor Match'
}

function recommendationForScore(score) {
  if (score >= 90) return 'Strongly Recommend'
  if (score >= 75) return 'Recommend'
  if (score >= 60) return 'Consider'
  return 'Not Recommended'
}

function validateGeminiScreeningResult(result, candidates) {
  if (!result || !Array.isArray(result.candidates) || !result.screeningSummary) {
    invalidScreeningResult('Gemini returned an incomplete screening result.')
  }

  if (result.candidates.length !== candidates.length) {
    invalidScreeningResult('Gemini did not return exactly one result per candidate.')
  }

  const expectedIds = new Set(candidates.map(candidate => candidate.id))
  const returnedIds = new Set()
  const returnedRanks = new Set()

  const screenedCandidates = result.candidates.map(candidate => {
    if (!candidate || typeof candidate.candidateId !== 'string') invalidScreeningResult()
    if (!expectedIds.has(candidate.candidateId) || returnedIds.has(candidate.candidateId)) {
      invalidScreeningResult('Gemini returned an unknown or duplicate candidate.')
    }

    const rank = integerInRange(candidate.rank, 1, candidates.length)
    if (returnedRanks.has(rank)) invalidScreeningResult('Gemini returned duplicate candidate ranks.')

    const matchScore = integerInRange(candidate.matchScore, 0, 100)
    const breakdown = candidate.scoreBreakdown
    if (!breakdown) invalidScreeningResult()

    const scoreBreakdown = {
      requiredSkills: integerInRange(breakdown.requiredSkills, 0, 35),
      relevantExperience: integerInRange(breakdown.relevantExperience, 0, 35),
      roleSimilarity: integerInRange(breakdown.roleSimilarity, 0, 20),
      preferredSkills: integerInRange(breakdown.preferredSkills, 0, 10),
    }

    const calculatedScore = Object.values(scoreBreakdown).reduce((total, score) => total + score, 0)
    if (calculatedScore !== matchScore) {
      invalidScreeningResult('Gemini returned a score that does not match its breakdown.')
    }

    const matchLevel = requiredText(candidate.matchLevel)
    const recommendation = requiredText(candidate.recommendation)
    if (
      matchLevel !== matchLevelForScore(matchScore)
      || recommendation !== recommendationForScore(matchScore)
    ) {
      invalidScreeningResult('Gemini returned a classification that does not match its score.')
    }

    if (!candidate.skills) invalidScreeningResult()

    returnedIds.add(candidate.candidateId)
    returnedRanks.add(rank)

    return {
      candidateId: candidate.candidateId,
      rank,
      candidateName: requiredText(candidate.candidateName),
      matchScore,
      scoreBreakdown,
      matchLevel,
      recommendation,
      experienceMatch: requiredText(candidate.experienceMatch),
      skills: {
        matched: textList(candidate.skills.matched),
        missingMandatory: textList(candidate.skills.missingMandatory),
        missingPreferred: textList(candidate.skills.missingPreferred),
      },
      strengths: textList(candidate.strengths),
      concerns: textList(candidate.concerns),
      summary: requiredText(candidate.summary),
    }
  }).sort((first, second) => first.rank - second.rank)

  screenedCandidates.forEach((candidate, index) => {
    if (candidate.rank !== index + 1) invalidScreeningResult('Gemini returned incomplete ranks.')
    if (index > 0 && candidate.matchScore > screenedCandidates[index - 1].matchScore) {
      invalidScreeningResult('Gemini did not rank candidates from highest to lowest score.')
    }
  })

  const summary = result.screeningSummary
  const levelCounts = {
    excellentMatches: screenedCandidates.filter(candidate => candidate.matchLevel === 'Excellent Match').length,
    strongMatches: screenedCandidates.filter(candidate => candidate.matchLevel === 'Strong Match').length,
    moderateMatches: screenedCandidates.filter(candidate => candidate.matchLevel === 'Moderate Match').length,
    weakMatches: screenedCandidates.filter(candidate => candidate.matchLevel === 'Weak Match').length,
    poorMatches: screenedCandidates.filter(candidate => candidate.matchLevel === 'Poor Match').length,
  }

  if (
    summary.totalCandidates !== screenedCandidates.length
    || Object.entries(levelCounts).some(([field, count]) => summary[field] !== count)
  ) {
    invalidScreeningResult('Gemini returned incorrect screening summary counts.')
  }

  const bestCandidate = screenedCandidates[0]
  if (
    summary.bestCandidateId !== bestCandidate.candidateId
    || summary.bestCandidate !== bestCandidate.candidateName
    || summary.bestCandidateScore !== bestCandidate.matchScore
  ) {
    invalidScreeningResult('Gemini summary does not match the top-ranked candidate.')
  }

  return {
    candidates: screenedCandidates,
    screeningSummary: {
      totalCandidates: screenedCandidates.length,
      ...levelCounts,
      bestCandidateId: bestCandidate.candidateId,
      bestCandidate: bestCandidate.candidateName,
      bestCandidateScore: bestCandidate.matchScore,
      overview: requiredText(summary.overview),
      commonStrengths: textList(summary.commonStrengths),
      commonGaps: textList(summary.commonGaps),
    },
  }
}

function diagnosticToken(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value)
    ? value
    : null
}

function safeGeminiMessage(value) {
  const message = typeof value === 'string' ? value.toLowerCase() : ''
  if (!message) return null
  if (/high demand|overload|capacity|temporarily unavailable/.test(message)) {
    return 'Gemini reported high demand or unavailable capacity.'
  }
  if (/model.*not found|not found.*model/.test(message)) {
    return 'Gemini reported that the requested model was not found.'
  }
  if (/api key|authentication|unauthenticated/.test(message)) {
    return 'Gemini reported an authentication problem.'
  }
  if (/permission|forbidden|access denied/.test(message)) {
    return 'Gemini reported a permission problem.'
  }
  if (/quota|rate limit|resource exhausted/.test(message)) {
    return 'Gemini reported a quota or rate-limit problem.'
  }
  if (/invalid|malformed|unknown parameter|unsupported/.test(message)) {
    return 'Gemini reported an invalid or unsupported request.'
  }
  return 'Gemini returned an error without a safely recordable message.'
}

function geminiFailureCategory(httpStatus, providerMessage = '') {
  const message = String(providerMessage).toLowerCase()
  if (httpStatus === 503 && /high demand|overload|capacity/.test(message)) return 'high_demand'
  if (httpStatus === 503) return 'service_unavailable'
  if (httpStatus === 429) return 'resource_exhausted'
  if (httpStatus === 404) return 'model_not_found'
  if (httpStatus === 408 || httpStatus === 504) return 'timeout'
  if (httpStatus === 400 || httpStatus === 413) return 'invalid_request'
  if (httpStatus === 401 || httpStatus === 403) return 'authentication_or_permission'
  if (httpStatus >= 500) return 'provider_error'
  return 'unexpected_provider_error'
}

async function readGeminiFailure(response) {
  let body = null
  try {
    body = JSON.parse(await response.text())
  } catch {
    body = null
  }

  const providerError = body?.error && typeof body.error === 'object' ? body.error : {}
  const details = Array.isArray(providerError.details) ? providerError.details : []
  const providerReason = details
    .map(detail => diagnosticToken(detail?.reason))
    .find(Boolean) || null
  const providerMessage = typeof providerError.message === 'string' ? providerError.message : ''

  return {
    httpStatus: response.status,
    providerCode: Number.isFinite(Number(providerError.code)) ? Number(providerError.code) : null,
    providerStatus: diagnosticToken(providerError.status),
    providerReason,
    category: geminiFailureCategory(response.status, providerMessage),
    safeMessage: safeGeminiMessage(providerMessage),
  }
}

function retryDelayMs(attempt) {
  const baseDelay = GEMINI_RETRY_DELAYS_MS[attempt - 1] || 0
  return baseDelay ? baseDelay + Math.floor(Math.random() * 500) : 0
}

async function requestGeminiGeneration({
  apiKey,
  requestBody,
  operation,
  uid,
  context = {},
  model = GEMINI_SCREENING_MODEL,
}) {
  const attempts = []
  let finalFailure = null

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GEMINI_GENERATION_TIMEOUT_MS)
    const startedAt = Date.now()
    let response

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: requestBody,
          signal: controller.signal,
        },
      )
    } catch (error) {
      const timedOut = error?.name === 'AbortError'
      finalFailure = {
        httpStatus: null,
        providerCode: null,
        providerStatus: null,
        providerReason: null,
        category: timedOut ? 'timeout' : 'network_error',
        safeMessage: timedOut
          ? 'The Gemini request exceeded the configured timeout.'
          : 'The Gemini request failed before receiving an HTTP response.',
      }
    } finally {
      clearTimeout(timeout)
    }

    if (response?.ok) {
      attempts.push({
        attempt,
        outcome: 'success',
        httpStatus: response.status,
        category: 'success',
        durationMs: Date.now() - startedAt,
      })
      if (attempt > 1) {
        logger.info('Gemini generation recovered after retry.', {
          uid,
          operation,
          model,
          attempt,
          ...context,
        })
      }
      return { response, attempts, failure: null }
    }

    if (response) finalFailure = await readGeminiFailure(response)
    const attemptRecord = {
      attempt,
      outcome: 'failed',
      httpStatus: finalFailure?.httpStatus || null,
      category: finalFailure?.category || 'unknown',
      durationMs: Date.now() - startedAt,
    }
    attempts.push(attemptRecord)

    const retryable = finalFailure?.httpStatus === null
      || GEMINI_RETRYABLE_STATUSES.has(finalFailure.httpStatus)
    const delayMs = retryable && attempt < GEMINI_MAX_ATTEMPTS ? retryDelayMs(attempt) : 0

    logger.warn('Gemini generation attempt failed.', {
      uid,
      operation,
      model,
      attempt,
      maxAttempts: GEMINI_MAX_ATTEMPTS,
      httpStatus: finalFailure?.httpStatus || null,
      providerStatus: finalFailure?.providerStatus || null,
      providerReason: finalFailure?.providerReason || null,
      category: finalFailure?.category || 'unknown',
      safeMessage: finalFailure?.safeMessage || null,
      durationMs: attemptRecord.durationMs,
      retrying: delayMs > 0,
      retryDelayMs: delayMs || null,
      ...context,
    })

    if (!delayMs) break
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  return { response: null, attempts, failure: finalFailure }
}

async function recordGeminiFailure({
  uid,
  operation,
  context = {},
  attempts,
  failure,
  requestMetadata = {},
  model = GEMINI_SCREENING_MODEL,
}) {
  try {
    const diagnosticRef = await db.collection('aiRequestDiagnostics').add({
      schemaVersion: 1,
      ownerId: uid,
      provider: 'gemini',
      model,
      operation,
      outcome: 'failed',
      category: failure?.category || 'unknown',
      httpStatus: failure?.httpStatus || null,
      providerCode: failure?.providerCode || null,
      providerStatus: failure?.providerStatus || null,
      providerReason: failure?.providerReason || null,
      safeMessage: failure?.safeMessage || null,
      attempts: attempts.map(attempt => ({
        attempt: attempt.attempt,
        outcome: attempt.outcome,
        httpStatus: attempt.httpStatus || null,
        category: attempt.category,
        durationMs: attempt.durationMs,
      })),
      requestMetadata,
      ...context,
      createdAt: FieldValue.serverTimestamp(),
    })
    return diagnosticRef.id
  } catch (error) {
    logger.error('Gemini failure diagnostic could not be saved.', {
      uid,
      operation,
      error: error?.code || error?.name || 'UnknownError',
      ...context,
    })
    return null
  }
}

function geminiError(failure, operation, attempts = GEMINI_MAX_ATTEMPTS, diagnosticId = null) {
  const status = failure?.httpStatus
  const operationLabels = {
    interview_plan: 'interview plan',
    interview_report: 'interview report',
  }
  const operationLabel = operationLabels[operation] || operation
  const details = {
    provider: 'gemini',
    category: failure?.category || 'unknown',
    httpStatus: status || null,
    diagnosticId,
  }

  if (failure?.category === 'timeout' || status === 408 || status === 504) {
    return new HttpsError(
      'deadline-exceeded',
      `Gemini took too long to complete the ${operationLabel}.`,
      details,
    )
  }

  if (failure?.category === 'network_error') {
    return new HttpsError(
      'unavailable',
      `Gemini could not be reached while generating the ${operationLabel}.`,
      details,
    )
  }

  if (status === 400 || status === 413) {
    return new HttpsError(
      'invalid-argument',
      `Gemini rejected the ${operationLabel} request as invalid or unsupported.`,
      details,
    )
  }

  if (status === 401 || status === 403) {
    return new HttpsError(
      'permission-denied',
      'This Gemini API key is invalid, expired, blocked, or not permitted to use the selected model.',
      details,
    )
  }

  if (status === 404) {
    return new HttpsError(
      'failed-precondition',
      'The configured Gemini model is not available to this API key.',
      details,
    )
  }

  if (status === 429) {
    return new HttpsError(
      'resource-exhausted',
      'This key cannot be used right now. Check its Gemini quota or billing and try again.',
      details,
    )
  }

  if (status === 503) {
    return new HttpsError(
      'unavailable',
      `Gemini is temporarily busy and could not complete the ${operationLabel} after ${attempts} attempts.`,
      details,
    )
  }

  if (status === 500 || status === 502) {
    return new HttpsError(
      'unavailable',
      `Gemini was temporarily unavailable and could not complete the ${operationLabel} after ${attempts} attempts.`,
      details,
    )
  }

  return new HttpsError(
    'internal',
    `Gemini returned an unexpected error while generating the ${operationLabel}.`,
    details,
  )
}

async function runGeminiScreeningTest(apiKey, files, jobPdfBase64, candidatePdfBase64, uid) {
  const candidateLabels = files.candidates.map((candidate, index) => ({
    text: `Candidate ${index + 1}. Use this exact candidateId in the response: ${candidate.id}. Candidate name recorded by the application: ${candidate.name}.`,
  }))
  const parts = [
    {
      text: [
        'You are an AI Recruitment Screening Assistant.',
        '',
        'Your task is to compare every supplied candidate resume against the supplied job description, calculate a fair match score, rank the candidates from best to worst, and provide concise recruiter-facing findings.',
        '',
        'IMPORTANT RULES',
        '- Evaluate candidates only using job-related information found in the supplied job description and resumes.',
        '- Never use or infer age, gender, religion, caste, race, nationality, marital status, disability, photograph, or any other protected or personal characteristic.',
        '- Do not invent qualifications, skills, experience, achievements, or employment details.',
        '- When required information is unavailable, use the exact phrase "Not mentioned in resume".',
        '- Distinguish between mandatory requirements and preferred requirements.',
        '- Missing an explicitly mandatory requirement must have a significant negative effect on the score.',
        '- Missing a preferred requirement must have a smaller effect.',
        '- Recognize equivalent technologies, related terminology, and genuinely transferable experience.',
        '- Give greater importance to recent and directly relevant experience.',
        '- Do not treat keyword repetition alone as evidence of competence.',
        '- Do not automatically reject an overqualified candidate.',
        '- Base every conclusion only on evidence contained in the supplied documents.',
        '- Evaluate every supplied candidate exactly once.',
        '- Do not add, omit, merge, or duplicate candidates.',
        '- Preserve every candidateId exactly as provided in the candidate label.',
        '',
        'SCREENING PROCESS',
        '',
        'STEP 1 — ANALYZE THE JOB DESCRIPTION',
        'Identify the job title, mandatory and preferred requirements, required experience, main responsibilities, relevant tools, technologies, domains, and role expectations.',
        'Do not return a separate job analysis section. Use this analysis only when evaluating candidates.',
        '',
        'STEP 2 — ANALYZE EVERY CANDIDATE',
        'For every candidate, evaluate relevant experience, demonstrated mandatory and preferred skills, missing requirements, responsibility similarity, transferable experience, strengths, and job-related concerns.',
        'Do not mark a skill as matched unless the resume provides reasonable evidence for it.',
        '',
        'STEP 3 — CALCULATE THE MATCH SCORE',
        'Calculate an integer match score from 0 to 100 using this exact breakdown:',
        '- Required skills: 0–35 points',
        '- Relevant experience: 0–35 points',
        '- Responsibilities and role similarity: 0–20 points',
        '- Preferred skills: 0–10 points',
        'The four component scores must add up exactly to matchScore.',
        'Award points according to the quality and relevance of evidence, not keyword counts.',
        'Reflect missing mandatory requirements primarily within the requiredSkills score.',
        'If an explicitly essential mandatory requirement is completely missing, matchScore must not exceed 59.',
        'If evidence is unclear, do not assume the candidate possesses the requirement.',
        'Use whole numbers and keep scores consistent across candidates.',
        '',
        'STEP 4 — CLASSIFY THE CANDIDATE',
        '- 90–100: "Excellent Match"',
        '- 75–89: "Strong Match"',
        '- 60–74: "Moderate Match"',
        '- 40–59: "Weak Match"',
        '- 0–39: "Poor Match"',
        '',
        'STEP 5 — PROVIDE A RECOMMENDATION',
        '- 90–100: "Strongly Recommend"',
        '- 75–89: "Recommend"',
        '- 60–74: "Consider"',
        '- 0–59: "Not Recommended"',
        'The recommendation must match the score range exactly.',
        '',
        'STEP 6 — RANK THE CANDIDATES',
        'Rank candidates from highest matchScore to lowest matchScore.',
        'For equal scores, compare mandatory requirements, directly relevant experience, required-skill evidence, role similarity, and preferred-skill evidence in that order.',
        'Ranks must start at 1 and must not be duplicated.',
        '',
        'STEP 7 — CREATE THE OVERALL SUMMARY',
        'Return the number of candidates in every match level, the best candidate, a concise comparison, common strengths, and common gaps.',
        'Only include common strengths or gaps that apply to at least two candidates. Otherwise return an empty array.',
        '',
        'OUTPUT REQUIREMENTS',
        '- Return only one valid JSON object without Markdown or code fences.',
        '- Use exactly the keys and structure shown below, with no additional keys.',
        '- Every score must be an integer and scoreBreakdown must add up to matchScore.',
        '- Use empty arrays when no supported items are found.',
        `- Return exactly ${files.candidates.length} candidates, one for every supplied candidateId.`,
        '- candidateId must exactly match the ID supplied with that resume.',
        '- candidateName must come from the supplied candidate label or resume.',
        '- Keep summaries concise, factual, and suitable for recruiter review.',
        '- screeningSummary counts must match the candidate matchLevel values.',
        '- bestCandidateId, bestCandidate, and bestCandidateScore must match the rank 1 candidate.',
        '',
        'REQUIRED JSON STRUCTURE',
        '{"candidates":[{"candidateId":"","rank":1,"candidateName":"","matchScore":0,"scoreBreakdown":{"requiredSkills":0,"relevantExperience":0,"roleSimilarity":0,"preferredSkills":0},"matchLevel":"","recommendation":"","experienceMatch":"","skills":{"matched":[],"missingMandatory":[],"missingPreferred":[]},"strengths":[],"concerns":[],"summary":""}],"screeningSummary":{"totalCandidates":0,"excellentMatches":0,"strongMatches":0,"moderateMatches":0,"weakMatches":0,"poorMatches":0,"bestCandidateId":"","bestCandidate":"","bestCandidateScore":0,"overview":"","commonStrengths":[],"commonGaps":[]}}',
      ].join('\n'),
    },
    { text: 'Job description PDF:' },
    { inlineData: { mimeType: 'application/pdf', data: jobPdfBase64 } },
  ]

  files.candidates.forEach((candidate, index) => {
    parts.push(candidateLabels[index])
    parts.push({ inlineData: { mimeType: 'application/pdf', data: candidatePdfBase64[index] } })
  })

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json' },
  })
  const context = { jobId: files.job.id }
  const requestMetadata = {
    requestBodyBytes: Buffer.byteLength(requestBody),
    jobPdfBytes: files.job.sizeBytes,
    candidatePdfBytes: files.candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0),
    candidateCount: files.candidates.length,
  }
  let requestResult = null

  try {
    requestResult = await requestGeminiGeneration({
      apiKey,
      requestBody,
      operation: 'screening',
      uid,
      context,
    })

    if (!requestResult.response) {
      const diagnosticId = await recordGeminiFailure({
        uid,
        operation: 'screening',
        context,
        attempts: requestResult.attempts,
        failure: requestResult.failure,
        requestMetadata,
      })
      throw geminiError(
        requestResult.failure,
        'screening',
        requestResult.attempts.length,
        diagnosticId,
      )
    }

    const responseBody = await requestResult.response.json()
    const responseText = responseBody?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')

    return validateGeminiScreeningResult(parseGeminiJson(responseText), files.candidates)
  } catch (error) {
    if (error instanceof HttpsError) {
      if (error.code === 'data-loss') {
        await recordGeminiFailure({
          uid,
          operation: 'screening',
          context,
          attempts: requestResult?.attempts || [],
          failure: {
            category: 'invalid_response',
            httpStatus: 200,
            safeMessage: 'Gemini returned a response that failed application validation.',
          },
          requestMetadata,
        })
      }
      throw error
    }

    logger.error('Gemini screening test request failed.', {
      uid,
      error: error?.name || 'UnknownError',
    })

    await recordGeminiFailure({
      uid,
      operation: 'screening',
      context,
      attempts: requestResult?.attempts || [],
      failure: {
        category: 'response_parse_error',
        httpStatus: requestResult?.response?.status || null,
        safeMessage: 'The Gemini response could not be parsed.',
      },
      requestMetadata,
    })

    throw new HttpsError('data-loss', 'Gemini returned an unreadable screening response. Try again.')
  }
}

async function verifyGeminiKey(apiKey, uid) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(GEMINI_MODELS_URL, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      const failure = await readGeminiFailure(response)
      logger.warn('Gemini API-key validation failed.', {
        uid,
        httpStatus: failure.httpStatus,
        providerStatus: failure.providerStatus,
        providerReason: failure.providerReason,
        category: failure.category,
        safeMessage: failure.safeMessage,
      })
      throw geminiError(failure, 'API key validation', 1)
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error

    logger.error('Gemini API-key validation request failed.', {
      uid,
      error: error?.name || 'UnknownError',
    })

    if (error?.name === 'AbortError') {
      throw new HttpsError('deadline-exceeded', 'Gemini took too long to respond. Try again.')
    }

    throw new HttpsError(
      'unavailable',
      'Gemini could not be reached. Check your connection and try again.',
    )
  } finally {
    clearTimeout(timeout)
  }
}

function validateEncryptionKey(value) {
  const key = Buffer.from(value || '', 'base64')
  if (key.length !== 32) {
    logger.error('Firestore encryption key has an invalid length.')
    throw new HttpsError('internal', 'API-key encryption is not configured correctly.')
  }

  return key
}

async function getOrCreateEncryptionKey() {
  const masterKeyRef = db.collection('systemSecrets').doc('geminiEncryption')

  const encodedKey = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(masterKeyRef)
    if (snapshot.exists) {
      return snapshot.get('masterKey')
    }

    const newKey = crypto.randomBytes(32).toString('base64')
    transaction.create(masterKeyRef, {
      masterKey: newKey,
      algorithm: 'AES-256-GCM',
      version: 1,
      createdAt: FieldValue.serverTimestamp(),
    })
    return newKey
  })

  return validateEncryptionKey(encodedKey)
}

async function getEncryptionKey() {
  const snapshot = await db.collection('systemSecrets').doc('geminiEncryption').get()

  if (!snapshot.exists) {
    throw new HttpsError(
      'failed-precondition',
      'API-key encryption is not configured. Save the Gemini API key again.',
    )
  }

  return validateEncryptionKey(snapshot.get('masterKey'))
}

async function encryptApiKey(apiKey, uid) {
  const iv = crypto.randomBytes(12)
  const encryptionKey = await getOrCreateEncryptionKey()
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  cipher.setAAD(Buffer.from(`gemini-key:${uid}:v1`, 'utf8'))
  const encryptedKey = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])

  return {
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    encryptionVersion: 1,
  }
}

async function decryptGeminiKey(uid) {
  const snapshot = await db.collection('userSecrets').doc(uid).get()

  if (!snapshot.exists) {
    throw new HttpsError(
      'failed-precondition',
      'No Gemini API key is saved. Add one in Profile before starting a screening.',
    )
  }

  const data = snapshot.data()
  if (
    data.encryptionVersion !== 1
    || typeof data.encryptedKey !== 'string'
    || typeof data.iv !== 'string'
    || typeof data.authTag !== 'string'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'The saved Gemini API key uses an unsupported format. Replace it in Profile.',
    )
  }

  try {
    const encryptionKey = await getEncryptionKey()
    const iv = Buffer.from(data.iv, 'base64')
    const authTag = Buffer.from(data.authTag, 'base64')
    const encryptedKey = Buffer.from(data.encryptedKey, 'base64')

    if (iv.length !== 12 || authTag.length !== 16 || encryptedKey.length === 0) {
      throw new Error('Invalid encrypted API-key fields')
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv)
    decipher.setAAD(Buffer.from(`gemini-key:${uid}:v1`, 'utf8'))
    decipher.setAuthTag(authTag)

    const decryptedKey = Buffer.concat([
      decipher.update(encryptedKey),
      decipher.final(),
    ]).toString('utf8')

    if (!decryptedKey || decryptedKey.length < 20 || decryptedKey.length > 512) {
      throw new Error('Invalid decrypted API key')
    }

    return decryptedKey
  } catch (error) {
    if (error instanceof HttpsError) throw error

    logger.error('Saved Gemini API-key decryption failed.', {
      uid,
      error: error?.name || 'UnknownError',
    })

    throw new HttpsError(
      'failed-precondition',
      'The saved Gemini API key could not be decrypted. Replace it in Profile.',
    )
  }
}

function invalidInterviewPlan(message = 'Gemini returned an invalid interview plan.') {
  throw new HttpsError('data-loss', message)
}

function interviewPlanText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) {
    invalidInterviewPlan(`Gemini returned an interview plan without ${label}.`)
  }
  return value.trim().slice(0, maximum)
}

function interviewPlanInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalidInterviewPlan(`Gemini returned an invalid ${label}.`)
  }
  return value
}

function interviewPlanQuestionNumbers(value, questionCount, label) {
  if (!Array.isArray(value) || value.length === 0) {
    invalidInterviewPlan(`Gemini returned ${label} without linked questions.`)
  }

  const numbers = [...new Set(value.map(number => (
    interviewPlanInteger(number, 1, questionCount, `${label} question number`)
  )))]
  return numbers.sort((a, b) => a - b)
}

function validateInterviewPlan(value, configuration) {
  if (!value || !Array.isArray(value.sections) || value.sections.length < 2 || value.sections.length > 4) {
    invalidInterviewPlan('Gemini must group the interview plan into 2 to 4 sections.')
  }

  const expectedCount = INTERVIEW_LENGTHS[configuration.lengthMinutes].questionCount
  const configuredTopics = new Map(configuration.topics.map(topic => [topic.toLowerCase(), topic]))
  const sections = []
  const questions = []

  value.sections.forEach((section, sectionIndex) => {
    if (!section || !Array.isArray(section.questions) || section.questions.length === 0) {
      invalidInterviewPlan(`Gemini returned an empty section at position ${sectionIndex + 1}.`)
    }

    const normalizedSection = {
      name: interviewPlanText(section.name, 'a section name', 180),
      questions: [],
    }

    section.questions.forEach(question => {
      const expectedNumber = questions.length + 1
      const number = interviewPlanInteger(question?.number, 1, expectedCount, 'question number')
      if (number !== expectedNumber) {
        invalidInterviewPlan('Gemini returned question numbers that are not sequential.')
      }

      const type = LEGACY_INTERVIEW_QUESTION_TYPES[question?.type] || question?.type
      if (!INTERVIEW_QUESTION_TYPES.has(type) || !configuration.questionTypes.includes(type)) {
        invalidInterviewPlan('Gemini returned a question type that the recruiter did not select.')
      }

      const rawTopic = interviewPlanText(question?.topic, 'a question topic', 180)
      const topic = configuredTopics.get(rawTopic.toLowerCase())
      if (!topic) {
        invalidInterviewPlan('Gemini returned a question topic outside the recruiter’s selected topics.')
      }

      if (!Array.isArray(question.good_answer_covers) || question.good_answer_covers.length < 3 || question.good_answer_covers.length > 4) {
        invalidInterviewPlan('Every interview question needs 3 to 4 observable answer-guide points.')
      }

      const normalizedQuestion = {
        id: `q${number}`,
        number,
        topic,
        type,
        minutes: interviewPlanInteger(question.minutes, 2, 5, 'question duration'),
        question: interviewPlanText(question.question, 'question wording', 800),
        goodAnswerCovers: question.good_answer_covers.map((item, index) => (
          interviewPlanText(item, `answer-guide point ${index + 1}`, 400)
        )),
        followUp: interviewPlanText(question.follow_up, 'a follow-up question', 500),
        watchOutFor: interviewPlanText(question.watch_out_for, 'a watch-out note', 400),
      }

      questions.push(normalizedQuestion)
      normalizedSection.questions.push(normalizedQuestion)
    })

    sections.push(normalizedSection)
  })

  if (questions.length !== expectedCount) {
    invalidInterviewPlan(`Gemini must return exactly ${expectedCount} interview questions.`)
  }

  const totalMinutes = questions.reduce((total, question) => total + question.minutes, 0)
  const minimumMinutes = Math.ceil(configuration.lengthMinutes * 0.9)
  const maximumMinutes = Math.floor(configuration.lengthMinutes * 0.95)
  if (totalMinutes < minimumMinutes || totalMinutes > maximumMinutes) {
    invalidInterviewPlan(
      `The planned question time must be between ${minimumMinutes} and ${maximumMinutes} minutes.`,
    )
  }
  if (value.total_questions !== expectedCount || value.total_minutes !== totalMinutes) {
    invalidInterviewPlan('Gemini returned totals that do not match the generated questions.')
  }

  const topicCoverage = configuration.topics.map(topic => {
    const matchingQuestions = questions.filter(question => question.topic === topic)
    if (matchingQuestions.length === 0) {
      invalidInterviewPlan(`Gemini did not cover the selected topic: ${topic}`)
    }
    return {
      topic,
      questionCount: matchingQuestions.length,
      questionNumbers: matchingQuestions.map(question => question.number),
    }
  })

  if (!Array.isArray(value.resume_points_to_probe) || value.resume_points_to_probe.length < 2 || value.resume_points_to_probe.length > 4) {
    invalidInterviewPlan('Gemini must return 2 to 4 resume points to probe.')
  }
  const resumePointsToProbe = value.resume_points_to_probe.map((item, index) => ({
    point: interviewPlanText(item?.point, `resume point ${index + 1}`, 500),
    questionNumbers: interviewPlanQuestionNumbers(
      item?.question_numbers || item?.linked_questions,
      expectedCount,
      `resume point ${index + 1}`,
    ),
  }))

  if (value.all_topics_covered !== true) {
    invalidInterviewPlan('Gemini reported that not every selected topic was covered.')
  }

  return {
    schemaVersion: 3,
    title: interviewPlanText(value.title, 'a plan title', 240),
    totalQuestions: expectedCount,
    totalMinutes,
    sections,
    resumePointsToProbe,
    topicCoverage,
    // Recruiters explicitly select these topics in the plan settings. Keeping
    // them on the approved plan makes the report's critical checks auditable.
    criticalTopics: [...configuration.topics],
    allTopicsCovered: true,
  }
}

function buildInterviewPlanPrompt(interview, _screeningResult, configuration) {
  const questionCount = INTERVIEW_LENGTHS[configuration.lengthMinutes].questionCount
  const minimumMinutes = Math.ceil(configuration.lengthMinutes * 0.9)
  const maximumMinutes = Math.floor(configuration.lengthMinutes * 0.95)

  return [
    'You are an expert interview designer for HR and recruitment teams. You create structured, fair, role-relevant interview plans that a hiring manager can run in a fixed time slot and later score against an answer guide.',
    '',
    'Rules:',
    '- Base every question on the attached job description. Use the attached resume only to tailor questions and identify claims or gaps to verify. Do not invent requirements, experience, or qualifications.',
    '- Questions must be job-related and lawful. Never ask about age, health, disability, family status, religion, ethnicity, nationality, or another protected characteristic. If right-to-work knowledge is relevant to the job, test the role knowledge without asking about the candidate’s own nationality or immigration status.',
    '- Write questions the interviewer can read aloud: plain, specific, and one idea per question. Do not use stacked or multi-part questions.',
    '- Match difficulty to the selected seniority.',
    '- Each question must have a clear answer guide so different interviewers can score the same answer consistently.',
    '- Do not repeat a question or test the same skill twice unless the topic genuinely needs more than one question.',
    '- Return valid JSON only. Do not include Markdown, commentary, or text outside the JSON object.',
    '',
    'Create an interview plan from the attached candidate resume PDF and job description PDF.',
    '',
    'CANDIDATE AND SETTINGS:',
    `- Candidate name: ${interview.candidateName}`,
    `- Role: ${interview.jobTitle}`,
    `- Interview length: ${configuration.lengthMinutes} minutes`,
    `- Seniority: ${configuration.seniority.toLowerCase()}`,
    `- Question types to include: ${configuration.questionTypes.join(', ')}`,
    `- Topics to cover: ${configuration.topics.join('; ')}`,
    `- Extra instructions from the interviewer: ${configuration.additionalInstructions || 'None'}`,
    '',
    'REQUIREMENTS:',
    `1. Generate exactly ${questionCount} questions. The question minutes must total between ${minimumMinutes} and ${maximumMinutes} minutes, leaving time for introductions and candidate questions. Allocate 2 to 5 minutes per question based on depth.`,
    '2. Cover every selected topic with at least one question. Give more questions to topics central to the job description.',
    '3. Use only the selected question types. Use situational and behavioural questions to test judgement, role_skill questions for hands-on ability, knowledge questions only where the job description requires specific knowledge, and values questions for job-related working behaviours.',
    '4. Group questions into 2 to 4 sections by theme. Number questions sequentially across the complete plan.',
    '5. Order questions from easier to harder within each section. Start with a comfortable, role-relevant question.',
    '6. For every question provide: topic, type, minutes, exact question wording, 3 to 4 observable good_answer_covers points, one follow_up, and one short watch_out_for red flag.',
    '7. Compare the resume with the job description and list 2 to 4 resume_points_to_probe. Each point must identify a claim, evidence gap, or listed skill to verify and reference the question_numbers that test it.',
    '8. Treat every recruiter-selected topic as critical for the later interview evaluation.',
    '9. Return a topic_coverage summary with each selected topic, its question_count, and its question_numbers.',
    '10. Before responding, verify that question numbers are sequential, totals match the questions, every selected topic is covered, every question topic exactly matches one selected topic, and the JSON is valid.',
    '',
    'OUTPUT FORMAT (JSON only):',
    '{',
    `  "title": "Interview plan · ${interview.candidateName}",`,
    `  "total_questions": ${questionCount},`,
    '  "total_minutes": 0,',
    '  "sections": [{',
    '    "name": "",',
    '    "questions": [{',
    '      "number": 1,',
    `      "topic": "one exact value from: ${configuration.topics.join(' | ')}",`,
    '      "type": "role_skill | situational | behavioural | knowledge | values",',
    '      "minutes": 0,',
    '      "question": "",',
    '      "good_answer_covers": ["", "", ""],',
    '      "follow_up": "",',
    '      "watch_out_for": ""',
    '    }]',
    '  }],',
    '  "resume_points_to_probe": [{',
    '    "point": "",',
    '    "question_numbers": [1]',
    '  }],',
    '  "topic_coverage": [{',
    '    "topic": "",',
    '    "question_count": 0,',
    '    "question_numbers": [1]',
    '  }],',
    '  "all_topics_covered": true',
    '}',
    '',
    'The job description PDF and candidate resume PDF are attached after this instruction.',
  ].join('\n')
}

async function runGeminiInterviewPlan(apiKey, files, interview, screeningResult, configuration, uid) {
  const prompt = buildInterviewPlanPrompt(interview, screeningResult, configuration)

  const requestBody = JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { text: 'Job description PDF:' },
        { inlineData: { mimeType: 'application/pdf', data: files.job.contents.toString('base64') } },
        { text: 'Candidate resume PDF:' },
        { inlineData: { mimeType: 'application/pdf', data: files.candidates[0].contents.toString('base64') } },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json' },
  })
  const context = { interviewId: interview.id, jobId: interview.jobId }
  const requestMetadata = {
    requestBodyBytes: Buffer.byteLength(requestBody),
    jobPdfBytes: files.job.sizeBytes,
    candidatePdfBytes: files.candidates[0].sizeBytes,
    candidateCount: 1,
  }
  let requestResult = null

  try {
    requestResult = await requestGeminiGeneration({
      apiKey,
      requestBody,
      operation: 'interview_plan',
      uid,
      context,
      model: GEMINI_INTERVIEW_MODEL,
    })

    if (!requestResult.response) {
      const diagnosticId = await recordGeminiFailure({
        uid,
        operation: 'interview_plan',
        context,
        attempts: requestResult.attempts,
        failure: requestResult.failure,
        requestMetadata,
        model: GEMINI_INTERVIEW_MODEL,
      })
      throw geminiError(
        requestResult.failure,
        'interview_plan',
        requestResult.attempts.length,
        diagnosticId,
      )
    }

    const responseBody = await requestResult.response.json()
    const responseText = responseBody?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
    return {
      ...validateInterviewPlan(parseGeminiJson(responseText), configuration),
      promptVersion: INTERVIEW_PLAN_PROMPT_VERSION,
      provider: 'gemini',
      model: GEMINI_INTERVIEW_MODEL,
    }
  } catch (error) {
    if (error instanceof HttpsError) {
      if (error.code === 'data-loss') {
        await recordGeminiFailure({
          uid,
          operation: 'interview_plan',
          context,
          attempts: requestResult?.attempts || [],
          failure: {
            category: 'invalid_response',
            httpStatus: 200,
            safeMessage: 'Gemini returned a response that failed application validation.',
          },
          requestMetadata,
          model: GEMINI_INTERVIEW_MODEL,
        })
      }
      throw error
    }
    logger.error('Gemini interview plan request failed.', {
      uid,
      interviewId: interview.id,
      error: error?.name || 'UnknownError',
    })
    await recordGeminiFailure({
      uid,
      operation: 'interview_plan',
      context,
      attempts: requestResult?.attempts || [],
      failure: {
        category: 'invalid_response',
        httpStatus: 200,
        safeMessage: 'Gemini returned a response that could not be parsed.',
      },
      requestMetadata,
      model: GEMINI_INTERVIEW_MODEL,
    })
    throw new HttpsError('data-loss', 'Gemini returned an unreadable interview plan. Try again.')
  }
}

exports.startInterviewPlan = onCall(
  FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const screeningId = requireDocumentId(request.data?.screeningId, 'screening report ID')
    const candidateId = requireDocumentId(request.data?.candidateId, 'candidate ID')
    const screeningRef = db.collection('screeningReports').doc(screeningId)
    const screeningSnapshot = await screeningRef.get()

    if (!screeningSnapshot.exists || screeningSnapshot.get('ownerId') !== uid) {
      throw new HttpsError('permission-denied', 'The screening report is unavailable.')
    }

    const screening = screeningSnapshot.data()
    const result = Array.isArray(screening.results)
      ? screening.results.find(item => item.candidateId === candidateId)
      : null
    if (!result) {
      throw new HttpsError('failed-precondition', 'This candidate is not part of the screening report.')
    }

    const jobId = requireDocumentId(screening.jobId, 'job ID')
    const [jobSnapshot, candidateSnapshot] = await Promise.all([
      db.collection('jobs').doc(jobId).get(),
      db.collection('candidates').doc(candidateId).get(),
    ])
    if (!jobSnapshot.exists || jobSnapshot.get('ownerId') !== uid) {
      throw new HttpsError('permission-denied', 'The selected job is unavailable.')
    }
    if (!candidateSnapshot.exists || candidateSnapshot.get('ownerId') !== uid) {
      throw new HttpsError('permission-denied', 'The selected candidate is unavailable.')
    }

    const job = jobSnapshot.data()
    const candidate = candidateSnapshot.data()
    const interviewId = interviewDocumentId(uid, jobId, candidateId)
    const interviewRef = db.collection('interviews').doc(interviewId)
    let created = false

    await db.runTransaction(async transaction => {
      const existing = await transaction.get(interviewRef)
      if (existing.exists) {
        if (existing.get('ownerId') !== uid) {
          throw new HttpsError('permission-denied', 'This interview is unavailable.')
        }
        transaction.update(interviewRef, { updatedAt: FieldValue.serverTimestamp() })
        return
      }

      created = true
      transaction.create(interviewRef, {
        schemaVersion: 1,
        ownerId: uid,
        candidateId,
        candidateName: candidate.name || result.candidateName || 'Unnamed candidate',
        role: candidate.role || screening.jobTitle || job.title || 'Candidate interview',
        jobId,
        jobTitle: screening.jobTitle || job.title || 'Untitled job',
        screeningReportId: screeningId,
        screeningScore: Number(result.matchScore || 0),
        screeningRecommendation: result.recommendation || '',
        status: 'plan_needed',
        currentStep: 1,
        settings: {
          lengthMinutes: 45,
          seniority: suggestedSeniority(job.title, candidate.role),
          questionTypes: ['role_skill', 'situational', 'behavioural'],
          topics: interviewTopics(job, candidate, result),
          additionalInstructions: '',
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })

    return { interviewId, created }
  },
)

exports.generateInterviewPlan = onCall(
  SCREENING_FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const interviewId = requireDocumentId(request.data?.interviewId, 'interview ID')
    const configuration = requireInterviewConfiguration(request.data?.configuration)
    const interviewRef = db.collection('interviews').doc(interviewId)
    const interviewSnapshot = await interviewRef.get()

    if (!interviewSnapshot.exists || interviewSnapshot.get('ownerId') !== uid) {
      throw new HttpsError('permission-denied', 'The interview is unavailable.')
    }

    const interview = { id: interviewId, ...interviewSnapshot.data() }
    const screeningSnapshot = await db.collection('screeningReports')
      .doc(requireDocumentId(interview.screeningReportId, 'screening report ID'))
      .get()
    if (!screeningSnapshot.exists || screeningSnapshot.get('ownerId') !== uid) {
      throw new HttpsError('failed-precondition', 'The linked screening report is unavailable.')
    }

    const screeningResult = (screeningSnapshot.get('results') || [])
      .find(result => result.candidateId === interview.candidateId)
    if (!screeningResult) {
      throw new HttpsError('failed-precondition', 'The candidate screening result is unavailable.')
    }

    const [files, apiKey] = await Promise.all([
      loadOwnedScreeningPdfs(uid, interview.jobId, [interview.candidateId]),
      decryptGeminiKey(uid),
    ])
    const plan = await runGeminiInterviewPlan(
      apiKey,
      files,
      interview,
      screeningResult,
      configuration,
      uid,
    )
    const nextVersion = Number(interview.planVersion || 0) + 1

    try {
      await interviewRef.update({
        settings: configuration,
        plan,
        planVersion: nextVersion,
        status: 'plan_ready',
        currentStep: 2,
        approvedAt: null,
        approvedBy: null,
        approvedPlanVersion: null,
        generatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (error) {
      logger.error('Generated interview plan could not be saved.', {
        uid,
        interviewId,
        error: error?.code || error?.name || 'UnknownError',
      })
      throw new HttpsError(
        'internal',
        'The interview plan was generated, but it could not be saved. Please try again.',
      )
    }

    return {
      interviewId,
      plan,
      planVersion: nextVersion,
      promptVersion: INTERVIEW_PLAN_PROMPT_VERSION,
      status: 'plan_ready',
    }
  },
)

exports.approveInterviewPlan = onCall(
  FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const interviewId = requireDocumentId(request.data?.interviewId, 'interview ID')
    const requestedPlanVersion = Number(request.data?.planVersion)

    if (!Number.isInteger(requestedPlanVersion) || requestedPlanVersion < 1) {
      throw new HttpsError('invalid-argument', 'A valid interview plan version is required.')
    }

    const interviewRef = db.collection('interviews').doc(interviewId)
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(interviewRef)
      if (!snapshot.exists || snapshot.get('ownerId') !== uid) {
        throw new HttpsError('permission-denied', 'The interview is unavailable.')
      }

      const interview = snapshot.data()
      const currentPlanVersion = Number(interview.planVersion || 0)
      const hasStructuredPlan = Array.isArray(interview.plan?.sections)
        && interview.plan.sections.some(section => Array.isArray(section.questions) && section.questions.length > 0)
      const hasLegacyPlan = Array.isArray(interview.plan?.questions) && interview.plan.questions.length > 0

      if (!hasStructuredPlan && !hasLegacyPlan) {
        throw new HttpsError('failed-precondition', 'Generate an interview plan before approving it.')
      }
      if (currentPlanVersion !== requestedPlanVersion) {
        throw new HttpsError(
          'failed-precondition',
          'This interview plan has changed. Refresh the page and review the latest version before approving it.',
        )
      }

      const approvedPlanVersion = Number(interview.approvedPlanVersion || 0)
      if (approvedPlanVersion === requestedPlanVersion && interview.approvedAt) {
        return {
          interviewId,
          planVersion: requestedPlanVersion,
          status: interview.status || 'plan_approved',
          alreadyApproved: true,
        }
      }
      if (approvedPlanVersion && approvedPlanVersion !== requestedPlanVersion) {
        throw new HttpsError(
          'failed-precondition',
          'A different interview plan version is already approved.',
        )
      }
      if (interview.status !== 'plan_ready') {
        throw new HttpsError('failed-precondition', 'This interview plan is not ready for approval.')
      }

      transaction.update(interviewRef, {
        status: 'plan_approved',
        currentStep: 3,
        approvedPlanVersion: requestedPlanVersion,
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      })

      return {
        interviewId,
        planVersion: requestedPlanVersion,
        status: 'plan_approved',
        alreadyApproved: false,
      }
    })
  },
)

function requireTranscript(value) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Paste the interview transcript before continuing.')
  }

  const transcript = value.trim()
  if (transcript.length < 20) {
    throw new HttpsError('invalid-argument', 'The interview transcript is too short.')
  }
  if (transcript.length > 200_000) {
    throw new HttpsError('invalid-argument', 'The interview transcript must be 200,000 characters or fewer.')
  }
  return transcript
}

function requireInterviewerNotes(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Recruiter notes must be text.')
  }
  const notes = value.trim()
  if (notes.length > 3_000) {
    throw new HttpsError('invalid-argument', 'Recruiter notes must be 3,000 characters or fewer.')
  }
  return notes
}

exports.saveInterviewTranscript = onCall(
  FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const interviewId = requireDocumentId(request.data?.interviewId, 'interview ID')
    const approvedPlanVersion = Number(request.data?.approvedPlanVersion)
    if (!Number.isInteger(approvedPlanVersion) || approvedPlanVersion < 1) {
      throw new HttpsError('invalid-argument', 'A valid approved interview plan version is required.')
    }

    const transcript = requireTranscript(request.data?.transcript)
    const interviewerNotes = requireInterviewerNotes(request.data?.interviewerNotes)
    if (typeof request.data?.removeContactDetails !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Choose whether contact details should be removed before AI processing.')
    }
    const removeContactDetails = request.data.removeContactDetails
    const wordCount = transcript.split(/\s+/).filter(Boolean).length
    const transcriptHash = crypto.createHash('sha256').update(JSON.stringify({
      approvedPlanVersion,
      transcript,
      interviewerNotes,
      removeContactDetails,
    })).digest('hex')
    const interviewRef = db.collection('interviews').doc(interviewId)
    const transcriptRef = db.collection('interviewTranscripts').doc(interviewId)

    return db.runTransaction(async transaction => {
      const [interviewSnapshot, transcriptSnapshot] = await Promise.all([
        transaction.get(interviewRef),
        transaction.get(transcriptRef),
      ])

      if (!interviewSnapshot.exists || interviewSnapshot.get('ownerId') !== uid) {
        throw new HttpsError('permission-denied', 'The interview is unavailable.')
      }
      if (transcriptSnapshot.exists && transcriptSnapshot.get('ownerId') !== uid) {
        throw new HttpsError('permission-denied', 'The interview transcript is unavailable.')
      }

      const interview = interviewSnapshot.data()
      const storedApprovedVersion = Number(interview.approvedPlanVersion || 0)
      if (!interview.approvedAt || storedApprovedVersion !== approvedPlanVersion) {
        throw new HttpsError(
          'failed-precondition',
          'The approved interview plan has changed. Return to the plan and approve the current version.',
        )
      }
      if (!['plan_approved', 'transcript_ready'].includes(interview.status)) {
        throw new HttpsError(
          'failed-precondition',
          interview.status === 'report_ready'
            ? 'This transcript is locked because its final report has already been generated.'
            : 'Approve the interview plan before saving a transcript.',
        )
      }

      const previousTranscriptHash = transcriptSnapshot.get('transcriptHash') || ''
      const previousTranscriptVersion = Number(transcriptSnapshot.get('transcriptVersion') || 0)
      const transcriptVersion = previousTranscriptHash === transcriptHash && previousTranscriptVersion > 0
        ? previousTranscriptVersion
        : previousTranscriptVersion + 1

      const transcriptData = {
        schemaVersion: 3,
        ownerId: uid,
        interviewId,
        candidateId: interview.candidateId,
        jobId: interview.jobId,
        approvedPlanVersion,
        transcriptVersion,
        transcriptHash,
        transcript,
        wordCount,
        speakerAttributionMode: 'gemini_inferred',
        interviewerNotes,
        removeContactDetails,
        status: 'ready',
        updatedAt: FieldValue.serverTimestamp(),
      }

      if (transcriptSnapshot.exists) {
        transaction.update(transcriptRef, {
          ...transcriptData,
          speakerMapping: FieldValue.delete(),
        })
      } else {
        transaction.create(transcriptRef, {
          ...transcriptData,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.update(interviewRef, {
        status: 'transcript_ready',
        currentStep: 4,
        transcriptId: interviewId,
        transcriptUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      return {
        interviewId,
        transcriptId: interviewId,
        approvedPlanVersion,
        transcriptVersion,
        transcriptHash,
        status: 'transcript_ready',
        wordCount,
        updated: transcriptSnapshot.exists,
      }
    })
  },
)

function invalidInterviewReport(message = 'Gemini returned an invalid interview report.') {
  throw new HttpsError('data-loss', message)
}

function interviewReportText(value, label, maximum, allowEmpty = false) {
  if (typeof value !== 'string') {
    invalidInterviewReport(`Gemini returned an interview report without ${label}.`)
  }
  const text = value.trim()
  if (!allowEmpty && !text) {
    invalidInterviewReport(`Gemini returned an interview report without ${label}.`)
  }
  if (text.length > maximum) {
    invalidInterviewReport(`Gemini returned ${label} that is too long.`)
  }
  return text
}

function interviewReportTextArray(value, label, maximumItems, maximumLength, allowEmpty = true) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximumItems) {
    invalidInterviewReport(`Gemini returned an invalid ${label}.`)
  }
  return value.map((item, index) => (
    interviewReportText(item, `${label} item ${index + 1}`, maximumLength)
  ))
}

function interviewReportScore(value, label, allowNull = false) {
  if (allowNull && value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 5) {
    invalidInterviewReport(`Gemini returned an invalid ${label}.`)
  }
  if (!Number.isInteger(value * 2)) {
    invalidInterviewReport(`${label} must use whole or half points.`)
  }
  return value
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10
}

function sameNumber(value, expected) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value - expected) < 0.001
}

function approvedPlanModel(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new HttpsError(
      'failed-precondition',
      'The approved interview plan is missing.',
    )
  }

  const hasStructuredSections = Array.isArray(plan.sections) && plan.sections.length > 0
  const hasLegacyQuestions = Array.isArray(plan.questions) && plan.questions.length > 0
  if (!hasStructuredSections && !hasLegacyQuestions) {
    throw new HttpsError('failed-precondition', 'The approved interview plan has no questions to evaluate.')
  }

  // New plans already contain named sections. Older approved plans stored one
  // flat questions array; wrap that array without changing the questions.
  const sourceFormat = hasStructuredSections ? 'structured' : 'legacy_flat'
  const sourceSections = hasStructuredSections
    ? plan.sections
    : [{ name: 'Interview questions', questions: plan.questions }]
  let questionIndex = 0

  const sections = sourceSections.map((section, sectionIndex) => {
    const area = typeof section?.name === 'string' && section.name.trim()
      ? section.name.trim()
      : `Section ${sectionIndex + 1}`
    const questions = Array.isArray(section?.questions) ? section.questions : []
    if (questions.length === 0) {
      throw new HttpsError('failed-precondition', 'The approved interview plan contains an empty section.')
    }
    return {
      area,
      questions: questions.map(question => {
        questionIndex += 1
        const goodAnswerCovers = Array.isArray(question?.goodAnswerCovers)
          ? question.goodAnswerCovers
          : Array.isArray(question?.good_answer_covers)
            ? question.good_answer_covers
            : Array.isArray(question?.goodAnswerIncludes)
              ? question.goodAnswerIncludes
              : Array.isArray(question?.good_answer_includes)
                ? question.good_answer_includes
                : []
        if (sourceFormat === 'legacy_flat' && goodAnswerCovers.length === 0) {
          throw new HttpsError(
            'failed-precondition',
            `Question ${questionIndex} in the older approved plan has no answer guide, so it cannot be scored fairly.`,
          )
        }
        return {
          ...question,
          area,
          number: Number(question?.number || question?.order || questionIndex),
          topic: typeof question?.topic === 'string' && question.topic.trim()
            ? question.topic.trim()
            : 'General',
          minutes: Number(question?.minutes || question?.estimatedMinutes || 0),
          question: question?.question || question?.prompt || '',
          goodAnswerCovers,
          followUp: question?.followUp || question?.follow_up || '',
          watchOutFor: question?.watchOutFor || question?.watch_out_for || '',
        }
      }),
    }
  })
  const questions = sections.flatMap(section => section.questions)
  if (questions.some((question, index) => question.number !== index + 1)) {
    throw new HttpsError('failed-precondition', 'The approved interview plan has invalid question numbers.')
  }

  const configuredCriticalTopics = Array.isArray(plan.criticalTopics)
    ? plan.criticalTopics
    : []
  const coverageTopics = Array.isArray(plan.topicCoverage)
    ? plan.topicCoverage.map(item => item?.topic)
    : []
  const questionTopics = questions.map(question => question.topic)
  const criticalTopics = uniqueTextItems([
    configuredCriticalTopics.length > 0
      ? configuredCriticalTopics
      : coverageTopics.length > 0
        ? coverageTopics
        : questionTopics,
  ], 12)

  const resumePointsToProbe = Array.isArray(plan.resumePointsToProbe)
    ? plan.resumePointsToProbe
    : []
  const evaluationPlan = {
    schemaVersion: plan.schemaVersion || 1,
    title: plan.title || 'Approved interview plan',
    totalQuestions: questions.length,
    totalMinutes: questions.reduce((total, question) => total + Number(question.minutes || 0), 0),
    sections: sections.map(section => ({
      name: section.area,
      questions: section.questions.map(({ area, ...question }) => question),
    })),
    criticalTopics,
    resumePointsToProbe,
  }

  return {
    sourceFormat,
    sections,
    questions,
    criticalTopics,
    resumePointsToProbe,
    evaluationPlan,
  }
}

function redactTranscriptContactDetails(transcript) {
  return transcript
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[phone removed]')
}

function normalizedEvidenceText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function validateTranscriptQuote(value, label, transcript) {
  const quote = interviewReportText(value, label, 800)
  const normalizedQuote = normalizedEvidenceText(quote)
  if (!normalizedEvidenceText(transcript).includes(normalizedQuote)) {
    invalidInterviewReport(`${label} is not a verbatim quote from the interview transcript.`)
  }
  return quote
}

function sameTextSet(first, second) {
  const normalize = values => values.map(value => String(value).trim().toLowerCase()).sort()
  return JSON.stringify(normalize(first)) === JSON.stringify(normalize(second))
}

function sameNumberSet(first, second) {
  const normalize = values => [...new Set(values.map(Number))].sort((a, b) => a - b)
  return JSON.stringify(normalize(first)) === JSON.stringify(normalize(second))
}

function validateInterviewReport(value, plan, transcript) {
  if (!value || typeof value !== 'object') invalidInterviewReport()

  const planModel = approvedPlanModel(plan)
  const planQuestionMap = new Map(planModel.questions.map(question => [question.number, question]))

  if (!Array.isArray(value.questions) || value.questions.length !== planModel.questions.length) {
    invalidInterviewReport('Gemini must evaluate every approved interview question exactly once.')
  }
  const returnedNumbers = value.questions.map(item => Number(item?.number))
  if (!sameNumberSet(returnedNumbers, planModel.questions.map(question => question.number))) {
    invalidInterviewReport('Gemini returned unknown, missing, or duplicate interview question numbers.')
  }

  const questions = planModel.questions.map(planQuestion => {
    const item = value.questions.find(candidate => Number(candidate?.number) === planQuestion.number)
    const status = item?.status
    if (status !== 'scored' && status !== 'not_covered') {
      invalidInterviewReport(`Question ${planQuestion.number} has an invalid status.`)
    }
    if (item?.area !== planQuestion.area) {
      invalidInterviewReport(`Question ${planQuestion.number} was assigned to the wrong plan area.`)
    }

    const score = interviewReportScore(item?.score, `question ${planQuestion.number} score`, true)
    const pointsHit = interviewReportTextArray(
      item?.points_hit || [],
      `question ${planQuestion.number} points hit`,
      4,
      400,
    )
    const pointsMissed = interviewReportTextArray(
      item?.points_missed || [],
      `question ${planQuestion.number} points missed`,
      4,
      400,
    )
    const evidenceQuotes = interviewReportTextArray(
      item?.evidence_quotes || [],
      `question ${planQuestion.number} evidence quotes`,
      2,
      800,
    ).map((quote, index) => validateTranscriptQuote(
      quote,
      `question ${planQuestion.number} evidence quote ${index + 1}`,
      transcript,
    ))

    if (status === 'not_covered') {
      if (score !== null || pointsHit.length > 0 || pointsMissed.length > 0 || evidenceQuotes.length > 0) {
        invalidInterviewReport(`Question ${planQuestion.number} is not covered and must use a null score with no evidence.`)
      }
    } else {
      if (score === null || evidenceQuotes.length === 0) {
        invalidInterviewReport(`Question ${planQuestion.number} needs a score and candidate evidence.`)
      }
      if (!sameTextSet([...pointsHit, ...pointsMissed], planQuestion.goodAnswerCovers)) {
        invalidInterviewReport(`Question ${planQuestion.number} must classify every approved answer-guide point exactly once.`)
      }
    }

    return {
      number: planQuestion.number,
      area: planQuestion.area,
      topic: planQuestion.topic,
      score,
      status,
      whatTheySaid: interviewReportText(
        item?.what_they_said || '',
        `question ${planQuestion.number} answer summary`,
        300,
        status === 'not_covered',
      ),
      pointsHit,
      pointsMissed,
      evidenceQuotes,
    }
  })

  if (!Array.isArray(value.scores_by_area) || value.scores_by_area.length !== planModel.sections.length) {
    invalidInterviewReport('Gemini must return exactly one score for every approved plan area.')
  }
  const areaNames = value.scores_by_area.map(item => item?.area)
  if (!sameTextSet(areaNames, planModel.sections.map(section => section.area))) {
    invalidInterviewReport('Gemini returned unknown, missing, or duplicate plan areas.')
  }
  const scoresByArea = planModel.sections.map(section => {
    const item = value.scores_by_area.find(candidate => candidate?.area === section.area)
    const scoredQuestions = questions.filter(question => question.area === section.area && question.status === 'scored')
    const expectedScore = scoredQuestions.length > 0
      ? roundToHalf(scoredQuestions.reduce((total, question) => total + question.score, 0) / scoredQuestions.length)
      : null
    const status = item?.status
    const score = interviewReportScore(item?.score, `${section.area} area score`, true)
    if (expectedScore === null) {
      if (status !== 'not_covered' || score !== null) {
        invalidInterviewReport(`${section.area} must be marked not covered with a null score.`)
      }
    } else if (status !== 'scored' || !sameNumber(score, expectedScore)) {
      invalidInterviewReport(`${section.area} does not match its question-score average.`)
    }
    return { area: section.area, score, status }
  })

  const scoredAreas = scoresByArea.filter(area => area.status === 'scored')
  const expectedOverall = scoredAreas.length > 0
    ? roundToTenth(scoredAreas.reduce((total, area) => total + area.score, 0) / scoredAreas.length)
    : null
  const overallScore = value.overall_score === null
    ? null
    : Number(value.overall_score)
  if ((expectedOverall === null && overallScore !== null) || (expectedOverall !== null && !sameNumber(overallScore, expectedOverall))) {
    invalidInterviewReport('Gemini returned an overall score that does not match the area scores.')
  }

  const notCoveredQuestions = questions.filter(question => question.status === 'not_covered')
  const coverage = value.plan_coverage
  if (
    !coverage
    || Number(coverage.covered) !== questions.length - notCoveredQuestions.length
    || Number(coverage.total) !== questions.length
    || !Array.isArray(coverage.not_covered_questions)
    || !sameNumberSet(
      coverage.not_covered_questions.map(item => item?.number),
      notCoveredQuestions.map(question => question.number),
    )
  ) {
    invalidInterviewReport('Gemini returned plan coverage that does not match the question evaluations.')
  }
  const normalizedNotCovered = notCoveredQuestions.map(question => {
    const item = coverage.not_covered_questions.find(candidate => Number(candidate?.number) === question.number)
    if (!item || item.topic !== question.topic) {
      invalidInterviewReport(`The not-covered entry for question ${question.number} has the wrong topic.`)
    }
    return { number: question.number, topic: question.topic }
  })

  const evidenceLevel = value.evidence_strength?.level
  if (!['High', 'Medium', 'Low'].includes(evidenceLevel)) {
    invalidInterviewReport('Gemini returned an invalid evidence-strength level.')
  }
  const evidenceStrength = {
    level: evidenceLevel,
    reason: interviewReportText(value.evidence_strength?.reason, 'an evidence-strength reason', 400),
  }

  const strengthsInput = value.strengths || []
  if (!Array.isArray(strengthsInput) || strengthsInput.length > 3) {
    invalidInterviewReport('Gemini returned too many strengths.')
  }
  const strengths = strengthsInput.map((item, index) => {
    const question = Number(item?.question)
    if (!planQuestionMap.has(question) || questions.find(candidate => candidate.number === question)?.status !== 'scored') {
      invalidInterviewReport(`Strength ${index + 1} references an invalid question.`)
    }
    return {
      title: interviewReportText(item?.title, `strength ${index + 1} title`, 120),
      description: interviewReportText(item?.description, `strength ${index + 1} description`, 350),
      quote: validateTranscriptQuote(item?.quote, `strength ${index + 1} quote`, transcript),
      question,
    }
  })

  const concernsInput = value.concerns || []
  if (!Array.isArray(concernsInput) || concernsInput.length > 4) {
    invalidInterviewReport('Gemini returned too many concerns.')
  }
  const concerns = concernsInput.map((item, index) => ({
    title: interviewReportText(item?.title, `concern ${index + 1} title`, 120),
    explanation: interviewReportText(item?.explanation, `concern ${index + 1} explanation`, 400),
    suggestedFollowUp: interviewReportText(item?.suggested_followup, `concern ${index + 1} follow-up`, 400),
  }))

  const criticalChecksInput = value.critical_topic_checks || []
  if (!Array.isArray(criticalChecksInput) || criticalChecksInput.length !== planModel.criticalTopics.length) {
    invalidInterviewReport('Gemini must check every approved critical topic exactly once.')
  }
  if (!sameTextSet(criticalChecksInput.map(item => item?.topic), planModel.criticalTopics)) {
    invalidInterviewReport('Gemini returned unknown, missing, or duplicate critical topics.')
  }
  const criticalTopicChecks = planModel.criticalTopics.map(topic => {
    const item = criticalChecksInput.find(candidate => candidate?.topic === topic)
    const topicQuestions = questions.filter(question => question.topic.toLowerCase() === topic.toLowerCase())
    const scoredTopicQuestions = topicQuestions.filter(question => question.status === 'scored')
    const expectedScore = scoredTopicQuestions.length > 0
      ? roundToHalf(scoredTopicQuestions.reduce((total, question) => total + question.score, 0) / scoredTopicQuestions.length)
      : null
    const score = interviewReportScore(item?.score, `${topic} critical-topic score`, true)
    const status = item?.status
    if (!['met', 'partially_met', 'not_met', 'not_covered'].includes(status)) {
      invalidInterviewReport(`${topic} has an invalid critical-topic status.`)
    }
    if (expectedScore === null) {
      if (status !== 'not_covered' || score !== null) {
        invalidInterviewReport(`${topic} must be not covered with a null score.`)
      }
    } else if (status === 'not_covered' || !sameNumber(score, expectedScore)) {
      invalidInterviewReport(`${topic} has a critical-topic score that does not match its questions.`)
    }
    const questionNumbers = Array.isArray(item?.question_numbers) ? item.question_numbers.map(Number) : []
    if (!sameNumberSet(questionNumbers, topicQuestions.map(question => question.number))) {
      invalidInterviewReport(`${topic} must reference every approved question for that topic.`)
    }
    const evidenceQuote = item?.evidence_quote === null || item?.evidence_quote === ''
      ? null
      : validateTranscriptQuote(item.evidence_quote, `${topic} critical-topic evidence quote`, transcript)
    return { topic, score, status, questionNumbers: questionNumbers.sort((a, b) => a - b), evidenceQuote }
  })

  const resumeProbeInput = value.resume_probe_results || []
  if (!Array.isArray(resumeProbeInput) || resumeProbeInput.length !== planModel.resumePointsToProbe.length) {
    invalidInterviewReport('Gemini must evaluate every approved resume point to probe exactly once.')
  }
  const resumeProbeResults = planModel.resumePointsToProbe.map((probe, index) => {
    const item = resumeProbeInput[index]
    if (item?.point !== probe.point) {
      invalidInterviewReport(`Resume probe ${index + 1} does not match the approved plan.`)
    }
    if (!['supported', 'partially_supported', 'not_supported', 'not_covered'].includes(item?.status)) {
      invalidInterviewReport(`Resume probe ${index + 1} has an invalid status.`)
    }
    const expectedQuestions = probe.questionNumbers || probe.question_numbers || []
    const questionNumbers = Array.isArray(item?.question_numbers) ? item.question_numbers.map(Number) : []
    if (!sameNumberSet(questionNumbers, expectedQuestions)) {
      invalidInterviewReport(`Resume probe ${index + 1} references the wrong questions.`)
    }
    const evidenceQuote = item?.evidence_quote === null || item?.evidence_quote === ''
      ? null
      : validateTranscriptQuote(item.evidence_quote, `resume probe ${index + 1} evidence quote`, transcript)
    return {
      point: probe.point,
      status: item.status,
      questionNumbers: questionNumbers.sort((a, b) => a - b),
      finding: interviewReportText(item?.finding, `resume probe ${index + 1} finding`, 400),
      evidenceQuote,
    }
  })

  const noteObservationsInput = value.interviewer_note_observations || []
  if (!Array.isArray(noteObservationsInput) || noteObservationsInput.length > 4) {
    invalidInterviewReport('Gemini returned invalid interviewer-note observations.')
  }
  const interviewerNoteObservations = noteObservationsInput.map((item, index) => ({
    observation: interviewReportText(item?.observation, `interviewer-note observation ${index + 1}`, 400),
    relatedQuestions: Array.isArray(item?.related_questions)
      ? item.related_questions.map(number => interviewPlanInteger(number, 1, questions.length, 'related question number'))
      : [],
    followUp: interviewReportText(item?.follow_up, `interviewer-note follow-up ${index + 1}`, 400),
  }))

  const decision = value.ai_suggestion?.decision
  if (!INTERVIEW_REPORT_DECISIONS.has(decision)) {
    invalidInterviewReport('Gemini returned an invalid advisory suggestion.')
  }
  const criticalProblem = criticalTopicChecks.some(check => check.score === null || check.score < 3)
  if (
    decision === 'Move to offer'
    && (overallScore === null || overallScore < 4.3 || evidenceLevel === 'Low' || criticalProblem)
  ) {
    invalidInterviewReport('Gemini suggested moving to offer without meeting the approved safeguards.')
  }

  return {
    schemaVersion: 1,
    overallScore,
    aiSuggestion: {
      decision,
      reason: interviewReportText(value.ai_suggestion?.reason, 'an advisory suggestion reason', 400),
      advisory: true,
    },
    planCoverage: {
      covered: questions.length - notCoveredQuestions.length,
      total: questions.length,
      notCoveredQuestions: normalizedNotCovered,
    },
    evidenceStrength,
    summary: interviewReportText(value.summary, 'a report summary', 1_200),
    scoresByArea,
    strengths,
    concerns,
    questions,
    criticalTopicChecks,
    resumeProbeResults,
    interviewerNoteObservations,
    dataQualityFlags: interviewReportTextArray(value.data_quality_flags || [], 'data-quality flags', 8, 300),
  }
}

function buildInterviewReportPrompt(interview, plan, transcriptDocument, transcriptForGemini) {
  const planModel = approvedPlanModel(plan)

  return [
    'You are an impartial interview evaluator supporting a human hiring manager. Score interview answers against the pre-approved plan and answer guide.',
    '',
    'RULES:',
    `- The candidate is ${interview.candidateName}. Infer which content belongs to the candidate from names, conversational context, timestamps, formatting, and the sequence of questions and answers. Do not require a fixed transcript format.`,
    '- Score only content you can confidently attribute to the candidate in the TRANSCRIPT EVIDENCE section. Never infer skills from the resume, job title, or interviewer notes.',
    '- Judge every answer only against its approved goodAnswerCovers points.',
    '- Quotes must be copied word for word from content you can confidently attribute to the candidate. Never quote interviewer speech, paraphrase inside quotation marks, or invent quotes.',
    '- Ignore accent, grammar, fluency, name, gender, age, health, family status, religion, ethnicity, nationality, disability, and anything unrelated to job-relevant content.',
    '- If a planned question was not asked or not answered, mark it not_covered and use null for its score. Never assign a low score merely because it was not covered.',
    '- If speaker attribution is ambiguous, do not guess. Mark the affected question not_covered, set evidence strength to Low when ambiguity is material, and add a data_quality_flag explaining the uncertainty.',
    '- Interviewer notes are unverified context. Keep them separate, do not use them as transcript evidence, and do not let them change any score.',
    '- The AI suggestion is advisory only. The human recruiter makes the decision.',
    '- Return valid JSON only, without Markdown or commentary.',
    '',
    `CANDIDATE: ${interview.candidateName}`,
    `ROLE: ${interview.jobTitle}`,
    '',
    'APPROVED INTERVIEW PLAN JSON:',
    JSON.stringify(planModel.evaluationPlan),
    '',
    `APPROVED CRITICAL TOPICS: ${planModel.criticalTopics.length > 0 ? planModel.criticalTopics.join(' | ') : 'None'}`,
    '',
    'APPROVED RESUME POINTS TO PROBE JSON:',
    JSON.stringify(planModel.resumePointsToProbe),
    '',
    'TRANSCRIPT EVIDENCE:',
    transcriptForGemini,
    '',
    'INTERVIEWER NOTES - UNVERIFIED CONTEXT, NEVER SCORE FROM THIS SECTION:',
    transcriptDocument.interviewerNotes || 'None',
    '',
    'SCORING SCALE (whole or half points only):',
    '1 = no relevant evidence',
    '2 = weak or very generic evidence',
    '3 = meets the role at a high level',
    '4 = specific and covers most approved guide points',
    '5 = strong, specific evidence covering all or nearly all approved guide points',
    'not_covered = null score because the planned question was not asked or answered',
    '',
    'TASKS:',
    `1. Identify ${interview.candidateName}'s answers from the transcript format and conversation, then match every planned question by meaning even if reworded or reordered. Include every approved question exactly once.`,
    '2. For scored questions, classify every approved goodAnswerCovers string exactly once into points_hit or points_missed. Copy those guide strings exactly. Include 1 or 2 verbatim candidate evidence_quotes. For not_covered questions, use score null and empty evidence arrays.',
    '3. Use the exact approved section name as each question area. Area score is the average of covered question scores rounded to the nearest 0.5. If none are covered, use null and not_covered.',
    '4. Overall score is the average of scored areas only, rounded to one decimal. If no area is scored, use null.',
    '5. Return exact plan coverage and identify the question number and exact topic for every not-covered question.',
    '6. Rate evidence strength High, Medium, or Low and briefly explain why.',
    '7. Return up to 3 strengths. Every strength needs one verbatim candidate quote and a covered question number.',
    '8. Return up to 4 concerns with a practical follow-up. Include weak evidence, uncovered questions, and unresolved approved resume probes where relevant.',
    '9. Evaluate every approved critical topic exactly once. Use all question numbers assigned to that topic and their average score, rounded to 0.5. If no question was covered, use status not_covered and score null.',
    '10. Evaluate every approved resume point to probe in the same order and with its exact point text and linked question numbers. Use only transcript evidence.',
    '11. Put any useful interviewer-note context only in interviewer_note_observations. This section must never contain scores or claims that the transcript proves the note.',
    '12. Provide a 3 to 4 sentence summary without score numbers.',
    '13. Choose one advisory suggestion: Move to offer, Move to next stage, Another interview, or Do not progress. Move to offer requires overall 4.3+, High or Medium evidence, and no critical topic below 3 or not covered.',
    '14. Add data-quality flags for incomplete transcripts, unclear speakers, unusually short evidence, redactions, or contradictions. Use an empty array when none apply.',
    '',
    'OUTPUT FORMAT (JSON only):',
    '{',
    '  "overall_score": null,',
    '  "ai_suggestion": { "decision": "", "reason": "" },',
    '  "plan_coverage": { "covered": 0, "total": 0, "not_covered_questions": [{ "number": 0, "topic": "" }] },',
    '  "evidence_strength": { "level": "High | Medium | Low", "reason": "" },',
    '  "summary": "",',
    '  "scores_by_area": [{ "area": "", "score": null, "status": "scored | not_covered" }],',
    '  "strengths": [{ "title": "", "description": "", "quote": "", "question": 0 }],',
    '  "concerns": [{ "title": "", "explanation": "", "suggested_followup": "" }],',
    '  "questions": [{',
    '    "number": 0, "area": "", "score": null, "status": "scored | not_covered",',
    '    "what_they_said": "", "points_hit": [""], "points_missed": [""], "evidence_quotes": [""]',
    '  }],',
    '  "critical_topic_checks": [{',
    '    "topic": "", "score": null, "status": "met | partially_met | not_met | not_covered",',
    '    "question_numbers": [1], "evidence_quote": null',
    '  }],',
    '  "resume_probe_results": [{',
    '    "point": "", "status": "supported | partially_supported | not_supported | not_covered",',
    '    "question_numbers": [1], "finding": "", "evidence_quote": null',
    '  }],',
    '  "interviewer_note_observations": [{ "observation": "", "related_questions": [1], "follow_up": "" }],',
    '  "data_quality_flags": []',
    '}',
    '',
    'Before responding, verify all arithmetic, exact question coverage, exact candidate quotes, critical topics, resume probes, and valid JSON.',
  ].join('\n')
}

async function runGeminiInterviewReport(apiKey, interview, plan, transcriptDocument, uid) {
  const transcriptForGemini = transcriptDocument.removeContactDetails
    ? redactTranscriptContactDetails(transcriptDocument.transcript)
    : transcriptDocument.transcript
  const prompt = buildInterviewReportPrompt(interview, plan, transcriptDocument, transcriptForGemini)
  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' },
  })
  const context = { interviewId: interview.id, jobId: interview.jobId }
  const requestMetadata = {
    requestBodyBytes: Buffer.byteLength(requestBody),
    transcriptCharacters: transcriptDocument.transcript.length,
    transcriptVersion: transcriptDocument.transcriptVersion,
    planVersion: interview.approvedPlanVersion,
  }
  let requestResult = null

  try {
    requestResult = await requestGeminiGeneration({
      apiKey,
      requestBody,
      operation: 'interview_report',
      uid,
      context,
      model: GEMINI_INTERVIEW_MODEL,
    })
    if (!requestResult.response) {
      const diagnosticId = await recordGeminiFailure({
        uid,
        operation: 'interview_report',
        context,
        attempts: requestResult.attempts,
        failure: requestResult.failure,
        requestMetadata,
        model: GEMINI_INTERVIEW_MODEL,
      })
      throw geminiError(
        requestResult.failure,
        'interview_report',
        requestResult.attempts.length,
        diagnosticId,
      )
    }

    const responseBody = await requestResult.response.json()
    const responseText = responseBody?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
    return validateInterviewReport(
      parseGeminiJson(responseText),
      plan,
      transcriptForGemini,
    )
  } catch (error) {
    if (error instanceof HttpsError) {
      if (error.code === 'data-loss') {
        await recordGeminiFailure({
          uid,
          operation: 'interview_report',
          context,
          attempts: requestResult?.attempts || [],
          failure: {
            category: 'invalid_response',
            httpStatus: 200,
            safeMessage: 'Gemini returned an interview report that failed application validation.',
          },
          requestMetadata,
          model: GEMINI_INTERVIEW_MODEL,
        })
      }
      throw error
    }
    logger.error('Gemini interview report request failed.', {
      uid,
      interviewId: interview.id,
      error: error?.name || 'UnknownError',
    })
    throw new HttpsError('data-loss', 'Gemini returned an unreadable interview report. Try again.')
  }
}

exports.generateInterviewReport = onCall(
  SCREENING_FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const interviewId = requireDocumentId(request.data?.interviewId, 'interview ID')
    const interviewRef = db.collection('interviews').doc(interviewId)
    const transcriptRef = db.collection('interviewTranscripts').doc(interviewId)
    const reportRef = db.collection('interviewReports').doc(interviewId)
    const generationId = crypto.randomUUID()
    const now = Date.now()

    const source = await db.runTransaction(async transaction => {
      const [interviewSnapshot, transcriptSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(interviewRef),
        transaction.get(transcriptRef),
        transaction.get(reportRef),
      ])
      if (!interviewSnapshot.exists || interviewSnapshot.get('ownerId') !== uid) {
        throw new HttpsError('permission-denied', 'The interview is unavailable.')
      }
      if (!transcriptSnapshot.exists || transcriptSnapshot.get('ownerId') !== uid) {
        throw new HttpsError('failed-precondition', 'Save the interview transcript before generating a report.')
      }

      const interview = { id: interviewId, ...interviewSnapshot.data() }
      const transcriptDocument = transcriptSnapshot.data()
      const planVersion = Number(interview.approvedPlanVersion || 0)
      const transcriptVersion = Number(transcriptDocument.transcriptVersion || 0)
      if (!interview.approvedAt || planVersion < 1 || !interview.plan) {
        throw new HttpsError('failed-precondition', 'Approve the interview plan before generating a report.')
      }
      if (transcriptDocument.approvedPlanVersion !== planVersion || transcriptVersion < 1 || !transcriptDocument.transcriptHash) {
        throw new HttpsError('failed-precondition', 'Save the transcript again so it is linked to the approved plan version.')
      }

      const existing = reportSnapshot.exists ? reportSnapshot.data() : null
      const sameSource = existing
        && Number(existing.sourcePlanVersion) === planVersion
        && Number(existing.sourceTranscriptVersion) === transcriptVersion
        && existing.sourceTranscriptHash === transcriptDocument.transcriptHash
      if (sameSource && existing.status === 'ready' && existing.report) {
        return { alreadyGenerated: true, report: existing.report }
      }
      if (existing?.status === 'ready' && !sameSource) {
        throw new HttpsError('failed-precondition', 'A final report already exists for a different saved transcript.')
      }
      const leaseExpiresAt = existing?.leaseExpiresAt?.toMillis?.() || Number(existing?.leaseExpiresAt) || 0
      if (sameSource && existing?.status === 'generating' && leaseExpiresAt > now) {
        throw new HttpsError('already-exists', 'This interview report is already being generated.')
      }

      transaction.set(reportRef, {
        schemaVersion: 1,
        ownerId: uid,
        interviewId,
        candidateId: interview.candidateId,
        candidateName: interview.candidateName,
        jobId: interview.jobId,
        jobTitle: interview.jobTitle,
        sourcePlanVersion: planVersion,
        sourceTranscriptVersion: transcriptVersion,
        sourceTranscriptHash: transcriptDocument.transcriptHash,
        status: 'generating',
        generationId,
        leaseExpiresAt: new Date(now + (10 * 60 * 1000)),
        promptVersion: INTERVIEW_REPORT_PROMPT_VERSION,
        provider: 'gemini',
        model: GEMINI_INTERVIEW_MODEL,
        error: null,
        updatedAt: FieldValue.serverTimestamp(),
        ...(reportSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true })
      transaction.update(interviewRef, {
        status: 'report_generating',
        currentStep: 5,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { interview, transcriptDocument, plan: interview.plan, alreadyGenerated: false }
    })

    if (source.alreadyGenerated) {
      return { interviewId, reportId: interviewId, status: 'report_ready', alreadyGenerated: true }
    }

    try {
      const apiKey = await decryptGeminiKey(uid)
      const report = await runGeminiInterviewReport(
        apiKey,
        source.interview,
        source.plan,
        source.transcriptDocument,
        uid,
      )

      await db.runTransaction(async transaction => {
        const reportSnapshot = await transaction.get(reportRef)
        if (!reportSnapshot.exists || reportSnapshot.get('generationId') !== generationId) {
          throw new HttpsError('aborted', 'This report generation was replaced by a newer request.')
        }
        transaction.update(reportRef, {
          status: 'ready',
          report,
          generationId: null,
          leaseExpiresAt: null,
          generatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          humanDecision: reportSnapshot.get('humanDecision') || null,
        })
        transaction.update(interviewRef, {
          status: 'report_ready',
          currentStep: 5,
          reportId: interviewId,
          reportGeneratedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      })

      return { interviewId, reportId: interviewId, status: 'report_ready', alreadyGenerated: false }
    } catch (error) {
      try {
        await db.runTransaction(async transaction => {
          const reportSnapshot = await transaction.get(reportRef)
          if (!reportSnapshot.exists || reportSnapshot.get('generationId') !== generationId) return
          transaction.update(reportRef, {
            status: 'failed',
            generationId: null,
            leaseExpiresAt: null,
            error: {
              code: error?.code || 'internal',
              message: error instanceof HttpsError
                ? error.message
                : 'The interview report could not be generated.',
            },
            updatedAt: FieldValue.serverTimestamp(),
          })
          transaction.update(interviewRef, {
            status: 'transcript_ready',
            currentStep: 4,
            updatedAt: FieldValue.serverTimestamp(),
          })
        })
      } catch (recoveryError) {
        logger.error('Interview report failure state could not be saved.', {
          uid,
          interviewId,
          error: recoveryError?.code || recoveryError?.name || 'UnknownError',
        })
      }
      throw error
    }
  },
)

exports.recordInterviewDecision = onCall(
  FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const interviewId = requireDocumentId(request.data?.interviewId, 'interview ID')
    const decision = typeof request.data?.decision === 'string' ? request.data.decision.trim() : ''
    const note = typeof request.data?.note === 'string' ? request.data.note.trim() : ''
    if (!INTERVIEW_REPORT_DECISIONS.has(decision)) {
      throw new HttpsError('invalid-argument', 'Choose a supported recruiter decision.')
    }
    if (note.length > 1_000) {
      throw new HttpsError('invalid-argument', 'The recruiter decision note must be 1,000 characters or fewer.')
    }

    const interviewRef = db.collection('interviews').doc(interviewId)
    const reportRef = db.collection('interviewReports').doc(interviewId)
    await db.runTransaction(async transaction => {
      const [interviewSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(interviewRef),
        transaction.get(reportRef),
      ])
      if (!interviewSnapshot.exists || interviewSnapshot.get('ownerId') !== uid) {
        throw new HttpsError('permission-denied', 'The interview is unavailable.')
      }
      if (!reportSnapshot.exists || reportSnapshot.get('ownerId') !== uid || reportSnapshot.get('status') !== 'ready') {
        throw new HttpsError('failed-precondition', 'Generate the final report before recording a decision.')
      }

      const humanDecision = {
        decision,
        note,
        recordedBy: uid,
        recordedAt: FieldValue.serverTimestamp(),
      }
      transaction.update(reportRef, { humanDecision, updatedAt: FieldValue.serverTimestamp() })
      transaction.update(interviewRef, {
        status: 'reviewed',
        humanDecision: decision,
        decisionRecordedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })

    return { interviewId, decision, status: 'reviewed' }
  },
)

if (process.env.NODE_ENV === 'test') {
  exports.__test = { approvedPlanModel, validateInterviewReport, redactTranscriptContactDetails }
}

exports.validateGeminiKey = onCall(
  FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const action = request.data?.action || 'validate'

    if (action === 'status') {
      const snapshot = await db.collection('userSecrets').doc(uid).get()

      if (!snapshot.exists) {
        return { connected: false, provider: 'gemini' }
      }

      const data = snapshot.data()
      return {
        connected: true,
        provider: 'gemini',
        keyEnding: data.keyEnding || '',
        validatedAt: data.validatedAt?.toMillis?.() || null,
      }
    }

    if (action === 'remove') {
      await db.collection('userSecrets').doc(uid).delete()
      return { removed: true, provider: 'gemini' }
    }

    const apiKey = requireApiKey(request.data?.apiKey)

    if (action === 'validate') {
      await verifyGeminiKey(apiKey, uid)
      return { valid: true, provider: 'gemini' }
    }

    if (action !== 'save') {
      throw new HttpsError('invalid-argument', 'Unsupported API-key action.')
    }

    // Validate again at save time so an unvalidated or changed key can never be stored.
    await verifyGeminiKey(apiKey, uid)

    const userSecretRef = db.collection('userSecrets').doc(uid)
    const existingSecret = await userSecretRef.get()
    const encrypted = await encryptApiKey(apiKey, uid)
    const now = FieldValue.serverTimestamp()

    await userSecretRef.set(
      {
        ...encrypted,
        provider: 'gemini',
        keyEnding: apiKey.slice(-4),
        validatedAt: now,
        updatedAt: now,
        ...(existingSecret.exists ? {} : { createdAt: now }),
      },
      { merge: true },
    )

    return {
      saved: true,
      provider: 'gemini',
      keyEnding: apiKey.slice(-4),
    }
  },
)

exports.prepareScreening = onCall(
  SCREENING_FUNCTION_OPTIONS,
  async request => {
    const uid = requireSignedIn(request)
    const jobId = requireDocumentId(request.data?.jobId, 'job ID')
    const candidateIds = requireCandidateIds(request.data?.candidateIds)
    const files = await loadOwnedScreeningPdfs(uid, jobId, candidateIds)
    const geminiApiKey = await decryptGeminiKey(uid)
    const jobPdfBase64 = files.job.contents.toString('base64')
    const candidatePdfBase64 = files.candidates.map(candidate => (
      candidate.contents.toString('base64')
    ))

    if (!geminiApiKey || !jobPdfBase64 || candidatePdfBase64.some(contents => !contents)) {
      throw new HttpsError(
        'internal',
        'The Gemini key or selected PDFs could not be prepared for screening.',
      )
    }

    const geminiTest = await runGeminiScreeningTest(
      geminiApiKey,
      files,
      jobPdfBase64,
      candidatePdfBase64,
      uid,
    )

    const generatedAt = Date.now()
    const results = geminiTest.candidates.map(result => {
      const sourceCandidate = files.candidates.find(candidate => candidate.id === result.candidateId)
      const filename = sourceCandidate?.filename || 'Uploaded resume'
      const storedPrefix = `${result.candidateId}-`

      return {
        ...result,
        resumeName: filename.startsWith(storedPrefix)
          ? filename.slice(storedPrefix.length)
          : filename,
      }
    })
    const reportRef = db.collection('screeningReports').doc()

    try {
      await reportRef.set({
        schemaVersion: 1,
        ownerId: uid,
        status: 'completed',
        provider: 'gemini',
        model: GEMINI_SCREENING_MODEL,
        jobId: files.job.id,
        jobTitle: files.job.title,
        jobFilename: files.job.filename,
        candidateIds: files.candidates.map(candidate => candidate.id),
        results,
        screeningSummary: geminiTest.screeningSummary,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (error) {
      logger.error('Validated screening report could not be saved.', {
        uid,
        jobId: files.job.id,
        error: error?.code || error?.name || 'UnknownError',
      })
      throw new HttpsError(
        'internal',
        'The screening finished, but its report could not be saved. Please try again.',
      )
    }

    // Return only the validated report and safe file metadata. Secrets and PDF data stay in backend memory.
    return {
      ready: true,
      geminiKeyReady: true,
      documentsEncoded: true,
      geminiTest: {
        candidates: results,
        screeningSummary: geminiTest.screeningSummary,
      },
      report: {
        id: reportRef.id,
        createdAt: generatedAt,
      },
      job: {
        id: files.job.id,
        title: files.job.title,
        filename: files.job.filename,
        contentType: files.job.contentType,
        sizeBytes: files.job.sizeBytes,
      },
      candidates: files.candidates.map(candidate => ({
        id: candidate.id,
        name: candidate.name,
        filename: candidate.filename,
        contentType: candidate.contentType,
        sizeBytes: candidate.sizeBytes,
      })),
    }
  },
)
