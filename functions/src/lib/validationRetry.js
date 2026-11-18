'use strict'

const { AppError } = require('./appError')

/**
 * Runs `generate(correction)` and `normalize(raw)`. If the response is structurally unusable
 * (AppError 'data-loss'), asks the model once more with a note describing the problem.
 * Provider errors (quota, auth, network…) are not retried here — the HTTP client already retries those.
 */
async function generateWithValidationRetry({ generate, normalize, buildCorrection, maxRetries = 1, onInvalid }) {
  let correction = ''
  let lastError = null

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const raw = await generate(correction)
    try {
      return { value: normalize(raw), validationAttempts: attempt + 1 }
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'data-loss') throw error
      lastError = error
      if (onInvalid) await onInvalid(error, attempt + 1)
      correction = buildCorrection(error.message)
    }
  }

  throw lastError
}

module.exports = { generateWithValidationRetry }
