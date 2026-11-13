'use strict'

const { AppError } = require('../lib/appError')

function diagnosticToken(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) ? value : null
}

/** Coarse, privacy-safe description of a provider message (raw messages are never stored). */
function safeGeminiMessage(value) {
  const message = typeof value === 'string' ? value.toLowerCase() : ''
  if (!message) return null
  if (/high demand|overload|capacity|temporarily unavailable/.test(message)) return 'Gemini reported high demand or unavailable capacity.'
  if (/model.*not found|not found.*model/.test(message)) return 'Gemini reported that the requested model was not found.'
  if (/api key|authentication|unauthenticated/.test(message)) return 'Gemini reported an authentication problem.'
  if (/permission|forbidden|access denied/.test(message)) return 'Gemini reported a permission problem.'
  if (/quota|rate limit|resource exhausted/.test(message)) return 'Gemini reported a quota or rate-limit problem.'
  if (/too large|payload|size/.test(message)) return 'Gemini reported that the request was too large.'
  if (/invalid|malformed|unknown parameter|unsupported/.test(message)) return 'Gemini reported an invalid or unsupported request.'
  return 'Gemini returned an error without a safely recordable message.'
}

function failureCategory(httpStatus, providerMessage = '') {
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

/** Reads a failed HTTP response into a diagnostic record (no secrets, no raw text). */
async function readFailure(response) {
  let body = null
  try {
    body = JSON.parse(await response.text())
  } catch {
    body = null
  }

  const providerError = body?.error && typeof body.error === 'object' ? body.error : {}
  const details = Array.isArray(providerError.details) ? providerError.details : []
  const providerMessage = typeof providerError.message === 'string' ? providerError.message : ''

  return {
    httpStatus: response.status,
    providerCode: Number.isFinite(Number(providerError.code)) ? Number(providerError.code) : null,
    providerStatus: diagnosticToken(providerError.status),
    providerReason: details.map(detail => diagnosticToken(detail?.reason)).find(Boolean) || null,
    category: failureCategory(response.status, providerMessage),
    safeMessage: safeGeminiMessage(providerMessage),
  }
}

const OPERATION_LABELS = {
  screening: 'screening',
  interview_plan: 'interview plan',
  final_report: 'final report',
  api_key_validation: 'API key check',
  file_upload: 'document upload',
}

/** Converts a final failure into a user-facing AppError. */
function geminiError(failure, operation, attempts = 1, diagnosticId = null) {
  const status = failure?.httpStatus
  const label = OPERATION_LABELS[operation] || operation
  const details = { provider: 'gemini', category: failure?.category || 'unknown', httpStatus: status || null, diagnosticId }

  if (failure?.category === 'timeout' || status === 408 || status === 504) {
    return new AppError('deadline-exceeded', `Gemini took too long to complete the ${label}. Please try again.`, details)
  }
  if (failure?.category === 'network_error') {
    return new AppError('unavailable', `Gemini could not be reached while preparing the ${label}. Please try again.`, details)
  }
  if (status === 413 || (status === 400 && /too large/i.test(failure?.safeMessage || ''))) {
    return new AppError('invalid-argument', `The documents are too large for Gemini to process in one ${label}. Use smaller PDFs.`, details)
  }
  if (status === 400) {
    return new AppError('invalid-argument', `Gemini rejected the ${label} request as invalid or unsupported.`, details)
  }
  if (status === 401 || status === 403) {
    return new AppError('permission-denied', 'Your Gemini API key is invalid, expired, blocked, or not allowed to use this model. Replace it in Profile.', details)
  }
  if (status === 404) {
    return new AppError('failed-precondition', 'The configured Gemini model is not available to your API key.', details)
  }
  if (status === 429) {
    return new AppError('resource-exhausted', 'Your Gemini key has no quota available right now. Check its quota or billing and try again.', details)
  }
  if (status === 503 || status === 500 || status === 502) {
    return new AppError('unavailable', `Gemini is temporarily busy and could not complete the ${label} after ${attempts} attempt${attempts === 1 ? '' : 's'}. Please try again shortly.`, details)
  }
  return new AppError('internal', `Gemini returned an unexpected error while preparing the ${label}.`, details)
}

module.exports = { readFailure, geminiError, failureCategory, safeGeminiMessage }
