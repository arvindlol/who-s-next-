'use strict'

const { fail } = require('../lib/appError')

const BLOCKED_FINISH_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'])

function parseJsonText(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    return JSON.parse(cleaned)
  } catch {
    return fail('data-loss', 'Gemini returned a response that is not valid JSON.')
  }
}

/** Extracts the JSON payload of a generateContent response, handling blocked and truncated answers. */
function extractJson(body) {
  const blockReason = body?.promptFeedback?.blockReason
  if (blockReason) {
    fail('failed-precondition', `Gemini refused to process these documents (${String(blockReason).toLowerCase()}). Check the uploaded files and try again.`)
  }

  const candidate = body?.candidates?.[0]
  if (!candidate) fail('data-loss', 'Gemini returned an empty response.')

  const finishReason = candidate.finishReason
  if (BLOCKED_FINISH_REASONS.has(finishReason)) {
    fail('failed-precondition', 'Gemini stopped because of its content filters. Check the uploaded documents and try again.')
  }
  if (finishReason === 'MAX_TOKENS') fail('data-loss', 'Gemini’s response was cut off before it finished.')

  const text = (candidate.content?.parts || [])
    .filter(part => !part.thought)
    .map(part => part.text || '')
    .join('')

  if (!text.trim()) fail('data-loss', 'Gemini returned an empty response.')
  return parseJsonText(text)
}

module.exports = { extractJson, parseJsonText }
