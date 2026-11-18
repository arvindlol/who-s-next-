// User-facing text for errors from Cloud Functions, Firestore and Storage.
// The backend's messages for these codes are written for recruiters, so they are shown as-is.

const SAFE_SERVER_CODES = new Set([
  'invalid-argument',
  'failed-precondition',
  'permission-denied',
  'resource-exhausted',
  'unavailable',
  'deadline-exceeded',
  'data-loss',
  'already-exists',
  'internal',
  'not-found',
])

const GENERIC_MESSAGES = /^(internal|not[\s_-]?found|unavailable|deadline[\s_-]?exceeded)$/i

export function callableErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const code = String(error?.code || '').replace(/^functions\//, '')
  const message = typeof error?.message === 'string' ? error.message.trim() : ''

  if (code === 'unauthenticated') return 'Your session has expired. Sign in again to continue.'
  if (code === 'not-found' && (!message || GENERIC_MESSAGES.test(message))) {
    return 'This feature is not available on the server yet. Deploy the latest Cloud Functions and try again.'
  }
  if (code === 'deadline-exceeded' && (!message || GENERIC_MESSAGES.test(message))) {
    return 'The request took too long. Please try again.'
  }
  if (code === 'unavailable' && (!message || GENERIC_MESSAGES.test(message))) {
    return 'The server could not be reached. Check your connection and try again.'
  }
  if (SAFE_SERVER_CODES.has(code) && message && !GENERIC_MESSAGES.test(message)) return message
  return fallback
}

export function firebaseErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  switch (error?.code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'You don’t have permission to do this. Sign in again and retry.'
    case 'storage/unauthorized':
      return 'File storage refused the upload. Check that the file is a PDF under 10 MB, then retry.'
    case 'storage/canceled':
      return 'The upload was cancelled.'
    case 'storage/quota-exceeded':
      return 'Storage space is full, so the file could not be saved.'
    case 'storage/retry-limit-exceeded':
    case 'storage/unknown':
    case 'unavailable':
      return 'We couldn’t reach the server. Check your connection and try again.'
    default:
      return String(error?.code || '').startsWith('functions/') ? callableErrorMessage(error, fallback) : fallback
  }
}
