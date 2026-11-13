'use strict'

/**
 * Fixed-window counter. Pure function so it can be unit-tested; the Firestore transaction
 * that stores the state lives in services/rateLimit.js.
 */
function applyRateLimit(state, now, { limit, windowMs }) {
  const hasWindow = Number.isFinite(Number(state?.windowStart)) && state?.windowStart !== null
  const windowStart = hasWindow ? Number(state.windowStart) : 0
  const count = Number(state?.count) || 0

  if (!hasWindow || now - windowStart >= windowMs) {
    return { allowed: true, state: { windowStart: now, count: 1 }, retryAfterMs: 0 }
  }

  if (count >= limit) {
    return { allowed: false, state: { windowStart, count }, retryAfterMs: windowStart + windowMs - now }
  }

  return { allowed: true, state: { windowStart, count: count + 1 }, retryAfterMs: 0 }
}

module.exports = { applyRateLimit }
