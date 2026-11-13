'use strict'

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { AppError } = require('../lib/appError')
const { REGION, ENFORCE_APP_CHECK } = require('../config')

const BASE_OPTIONS = {
  region: REGION,
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 10,
  // Callable functions must be publicly invocable; authentication is checked below.
  invoker: 'public',
  enforceAppCheck: ENFORCE_APP_CHECK,
}

/**
 * Defines an authenticated callable function.
 * The handler receives (data, context) where context = { uid, token, request }.
 * AppErrors become HttpsErrors with the same code; anything else becomes a generic 'internal' error.
 */
function callable(name, options, handler) {
  return onCall({ ...BASE_OPTIONS, ...options }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Your session has expired. Sign in again to continue.')

    try {
      return await handler(request.data || {}, { uid: request.auth.uid, token: request.auth.token || {}, request })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      if (error instanceof AppError) throw new HttpsError(error.code, error.message, error.details)
      if (error?.code === 6 || error?.code === 'already-exists') {
        throw new HttpsError('already-exists', 'This request was already submitted.')
      }

      logger.error(`Unhandled error in ${name}.`, {
        uid: request.auth.uid,
        error: error?.message?.slice(0, 300) || error?.name || 'UnknownError',
      })
      throw new HttpsError('internal', 'Something went wrong on the server. Please try again.')
    }
  })
}

module.exports = { callable }
