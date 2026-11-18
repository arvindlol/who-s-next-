'use strict'

const { db, FieldValue, Timestamp } = require('./firebase')
const { applyRateLimit } = require('../lib/rateLimit')
const { fail } = require('../lib/appError')
const { RATE_LIMITS } = require('../config')

const OPERATION_LABELS = {
  apiKey: 'API-key checks',
  screening: 'screenings',
  interviewPlan: 'interview plans',
  finalReport: 'final reports',
}

/** Counts one use of `operation` for the user; throws resource-exhausted when over the limit. */
async function enforceRateLimit(uid, operation) {
  const policy = RATE_LIMITS[operation]
  if (!policy) return

  const ref = db.collection('rateLimits').doc(`${uid}_${operation}`)
  const result = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    const now = Date.now()
    const outcome = applyRateLimit(snapshot.exists ? snapshot.data() : null, now, policy)
    if (outcome.allowed) {
      transaction.set(ref, {
        ownerId: uid,
        operation,
        ...outcome.state,
        updatedAt: FieldValue.serverTimestamp(),
        expireAt: Timestamp.fromMillis(outcome.state.windowStart + policy.windowMs * 2),
      })
    }
    return outcome
  })

  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60_000))
    fail('resource-exhausted', `You have reached the limit of ${policy.limit} ${OPERATION_LABELS[operation]} per hour. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  }
}

module.exports = { enforceRateLimit }
