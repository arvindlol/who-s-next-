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
const INTERVIEW_PLAN_PROMPT_VERSION = 'interview-plan-structured-v2'
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
  const operationLabel = operation === 'interview_plan' ? 'interview plan' : operation
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
    schemaVersion: 2,
    title: interviewPlanText(value.title, 'a plan title', 240),
    totalQuestions: expectedCount,
    totalMinutes,
    sections,
    resumePointsToProbe,
    topicCoverage,
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
    '8. Return a topic_coverage summary with each selected topic, its question_count, and its question_numbers.',
    '9. Before responding, verify that question numbers are sequential, totals match the questions, every selected topic is covered, every question topic exactly matches one selected topic, and the JSON is valid.',
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
