'use strict'

const { callable } = require('./callable')
const { fail } = require('../lib/appError')
const { requireApiKey } = require('../lib/validation')
const { USE_GEMINI_MOCK } = require('../config')
const { gemini } = require('../services/gemini')
const { enforceRateLimit } = require('../services/rateLimit')
const { ENCRYPTION_SECRET, saveApiKey, getApiKeyStatus, removeApiKey } = require('../services/keys')

/**
 * One endpoint for the Profile page's key management.
 * actions: 'status' | 'validate' | 'save' | 'remove'
 */
const validateGeminiKey = callable('validateGeminiKey', { secrets: [ENCRYPTION_SECRET] }, async (data, { uid }) => {
  const action = data.action || 'validate'

  if (action === 'status') return getApiKeyStatus(uid)

  if (action === 'remove') {
    await removeApiKey(uid)
    return { removed: true, provider: 'gemini' }
  }

  if (action !== 'validate' && action !== 'save') fail('invalid-argument', 'Unsupported API-key action.')

  const apiKey = requireApiKey(data.apiKey)
  await enforceRateLimit(uid, 'apiKey')

  // Validated again on save, so an unchecked or changed key can never be stored.
  if (!USE_GEMINI_MOCK) await gemini.verifyKey(apiKey, uid)

  if (action === 'validate') return { valid: true, provider: 'gemini' }

  const keyEnding = await saveApiKey(uid, apiKey)
  return { saved: true, provider: 'gemini', keyEnding }
})

module.exports = { validateGeminiKey }
