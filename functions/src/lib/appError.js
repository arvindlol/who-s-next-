'use strict'

/**
 * Error type used by all dependency-free modules.
 * `code` uses the Firebase callable error codes (invalid-argument, failed-precondition, …),
 * so the callable wrapper can convert it to an HttpsError without translation.
 */
class AppError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new AppError(code, message, details)
}

module.exports = { AppError, fail }
