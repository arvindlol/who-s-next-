const crypto = require('node:crypto')
const { initializeApp } = require('firebase-admin/app')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const { HttpsError, onCall } = require('firebase-functions/v2/https')

initializeApp()

const db = getFirestore()
const GEMINI_MODELS_URL =
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'
const REQUEST_TIMEOUT_MS = 10_000
const FUNCTION_OPTIONS = {
  region: 'asia-south1',
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 10,
  invoker: 'public',
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

function geminiError(status, uid) {
  // Log only the user ID and HTTP status. Never log the submitted API key or response body.
  logger.warn('Gemini API-key validation failed.', { uid, status })

  if (status === 400 || status === 401 || status === 403) {
    return new HttpsError(
      'permission-denied',
      'This Gemini API key is invalid, expired, blocked, or not permitted to use the Gemini API.',
    )
  }

  if (status === 429) {
    return new HttpsError(
      'resource-exhausted',
      'This key cannot be used right now. Check its Gemini quota or billing and try again.',
    )
  }

  return new HttpsError(
    'unavailable',
    'Gemini could not validate the key right now. Please try again shortly.',
  )
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
      throw geminiError(response.status, uid)
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
