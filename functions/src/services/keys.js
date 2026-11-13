'use strict'

const crypto = require('node:crypto')
const { defineSecret } = require('firebase-functions/params')
const { db, FieldValue, logger } = require('./firebase')
const { fail, AppError } = require('../lib/appError')
const { parseMasterKey, encryptSecret, decryptSecret } = require('../lib/crypto')

// Base64-encoded 32-byte key in Cloud Secret Manager. Create it with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//   firebase functions:secrets:set GEMINI_KEY_ENCRYPTION_KEY
const ENCRYPTION_SECRET = defineSecret('GEMINI_KEY_ENCRYPTION_KEY')

// Version 1 keys were encrypted with a master key stored in Firestore (systemSecrets/geminiEncryption).
// It is still read to decrypt old records and is only created as a fallback when the secret is missing.
const LEGACY_KEY_REF = () => db.collection('systemSecrets').doc('geminiEncryption')
const CURRENT_VERSION = 2
const LEGACY_VERSION = 1

function secretMasterKey() {
  let value = ''
  try {
    value = ENCRYPTION_SECRET.value()
  } catch {
    value = ''
  }
  return value ? parseMasterKey(value) : null
}

async function legacyMasterKey({ create = false } = {}) {
  const ref = LEGACY_KEY_REF()
  if (!create) {
    const snapshot = await ref.get()
    return snapshot.exists ? parseMasterKey(snapshot.get('masterKey')) : null
  }

  const encoded = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (snapshot.exists) return snapshot.get('masterKey')
    const newKey = crypto.randomBytes(32).toString('base64')
    transaction.create(ref, { masterKey: newKey, algorithm: 'AES-256-GCM', version: 1, createdAt: FieldValue.serverTimestamp() })
    return newKey
  })
  return parseMasterKey(encoded)
}

async function encryptForStorage(apiKey, uid) {
  const key = secretMasterKey()
  if (key) return encryptSecret(apiKey, key, uid, CURRENT_VERSION)

  logger.warn('GEMINI_KEY_ENCRYPTION_KEY is not set; using the legacy Firestore master key.')
  return encryptSecret(apiKey, await legacyMasterKey({ create: true }), uid, LEGACY_VERSION)
}

async function saveApiKey(uid, apiKey) {
  const ref = db.collection('userSecrets').doc(uid)
  const existing = await ref.get()
  const now = FieldValue.serverTimestamp()

  await ref.set({
    ...(await encryptForStorage(apiKey, uid)),
    provider: 'gemini',
    keyEnding: apiKey.slice(-4),
    validatedAt: now,
    updatedAt: now,
    ...(existing.exists ? {} : { createdAt: now }),
  }, { merge: true })

  return apiKey.slice(-4)
}

async function getApiKeyStatus(uid) {
  const snapshot = await db.collection('userSecrets').doc(uid).get()
  if (!snapshot.exists) return { connected: false, provider: 'gemini' }
  return {
    connected: true,
    provider: 'gemini',
    keyEnding: snapshot.get('keyEnding') || '',
    validatedAt: snapshot.get('validatedAt')?.toMillis?.() || null,
  }
}

async function removeApiKey(uid) {
  await db.collection('userSecrets').doc(uid).delete()
}

/** Decrypts the user's Gemini key. Version-1 records are upgraded to version 2 when the secret exists. */
async function getApiKey(uid) {
  const ref = db.collection('userSecrets').doc(uid)
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    fail('failed-precondition', 'No Gemini API key is saved. Add one in Profile first.')
  }

  const record = snapshot.data()
  if (![LEGACY_VERSION, CURRENT_VERSION].includes(record.encryptionVersion)) {
    fail('failed-precondition', 'The saved Gemini API key uses an unsupported format. Replace it in Profile.')
  }

  let apiKey
  try {
    const key = record.encryptionVersion === CURRENT_VERSION ? secretMasterKey() : await legacyMasterKey()
    if (!key) fail('internal', 'API-key encryption is not configured on the server.')
    apiKey = decryptSecret(record, key, uid)
  } catch (error) {
    if (error instanceof AppError) throw error
    logger.error('Saved Gemini API-key decryption failed.', { uid, error: error?.name || 'UnknownError' })
    fail('failed-precondition', 'The saved Gemini API key could not be opened. Replace it in Profile.')
  }

  if (!apiKey || apiKey.length < 20 || apiKey.length > 512) {
    fail('failed-precondition', 'The saved Gemini API key is invalid. Replace it in Profile.')
  }

  if (record.encryptionVersion === LEGACY_VERSION && secretMasterKey()) {
    try {
      await ref.update({ ...encryptSecret(apiKey, secretMasterKey(), uid, CURRENT_VERSION), updatedAt: FieldValue.serverTimestamp() })
    } catch (error) {
      logger.warn('Could not upgrade the API-key encryption version.', { uid, error: error?.code || error?.name })
    }
  }

  return apiKey
}

module.exports = { ENCRYPTION_SECRET, saveApiKey, getApiKey, getApiKeyStatus, removeApiKey }
