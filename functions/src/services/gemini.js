'use strict'

const { db, FieldValue, logger, expireAfter } = require('./firebase')
const { createGeminiClient } = require('../gemini/client')
const { LIMITS } = require('../config')

/** Stores a privacy-safe diagnostic record of a failed Gemini call; returns its ID (or null). */
async function recordFailure({ uid, operation, model, context = {}, attempts = [], failure, requestMetadata = {} }) {
  try {
    const ref = await db.collection('aiRequestDiagnostics').add({
      schemaVersion: 2,
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
      context,
      createdAt: FieldValue.serverTimestamp(),
      // Enable a TTL policy on aiRequestDiagnostics.expireAt in the console to auto-delete these.
      expireAt: expireAfter(LIMITS.diagnosticsRetentionMs),
    })
    return ref.id
  } catch (error) {
    logger.error('Gemini failure diagnostic could not be saved.', { uid, operation, error: error?.code || error?.name || 'UnknownError' })
    return null
  }
}

/** Records a response that reached us but failed validation (used before a validation retry). */
function recordInvalidResponse({ uid, operation, model, context, message, attempt }) {
  return recordFailure({
    uid,
    operation,
    model,
    context: { ...context, validationAttempt: attempt },
    failure: { category: 'invalid_response', httpStatus: 200, safeMessage: String(message).slice(0, 200) },
  })
}

const gemini = createGeminiClient({ logger, recordFailure })

module.exports = { gemini, recordFailure, recordInvalidResponse }
