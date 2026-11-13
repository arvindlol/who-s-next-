'use strict'

const crypto = require('node:crypto')
const { fail } = require('./appError')

const ALGORITHM = 'aes-256-gcm'

/** Decodes a base64 AES-256 key; throws a configuration error if it is not 32 bytes. */
function parseMasterKey(base64Value) {
  const key = Buffer.from(String(base64Value || '').trim(), 'base64')
  if (key.length !== 32) fail('internal', 'API-key encryption is not configured correctly.')
  return key
}

function aadFor(uid, version) {
  return Buffer.from(`gemini-key:${uid}:v${version}`, 'utf8')
}

function encryptSecret(plaintext, key, uid, version) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(aadFor(uid, version))
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    encryptionVersion: version,
  }
}

function decryptSecret(record, key, uid) {
  const version = record?.encryptionVersion
  const iv = Buffer.from(String(record?.iv || ''), 'base64')
  const authTag = Buffer.from(String(record?.authTag || ''), 'base64')
  const encrypted = Buffer.from(String(record?.encryptedKey || ''), 'base64')

  if (iv.length !== 12 || authTag.length !== 16 || encrypted.length === 0) {
    throw new Error('Invalid encrypted fields')
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAAD(aadFor(uid, version))
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

/** Deterministic interview ID per owner, job, candidate and round (round 1 keeps the original format). */
function interviewDocumentId(uid, jobId, candidateId, round = 1) {
  const suffix = round > 1 ? `:r${round}` : ''
  return crypto.createHash('sha256').update(`${uid}:${jobId}:${candidateId}${suffix}`).digest('hex').slice(0, 32)
}

module.exports = { parseMasterKey, encryptSecret, decryptSecret, interviewDocumentId }
