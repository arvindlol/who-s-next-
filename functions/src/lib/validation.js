'use strict'

const { fail } = require('./appError')
const { cleanText, cleanMultilineText, uniqueTextItems } = require('./text')
const { DECISIONS } = require('./statuses')
const {
  INTERVIEW_LENGTHS,
  INTERVIEW_SENIORITIES,
  INTERVIEW_QUESTION_TYPES,
  LEGACY_INTERVIEW_QUESTION_TYPES,
  LIMITS,
} = require('../config')

const AUTO_ID_PATTERN = /^[A-Za-z0-9]{20}$/

function requireDocumentId(value, label) {
  if (typeof value !== 'string') fail('invalid-argument', `A valid ${label} is required.`)
  const id = value.trim()
  if (!id || id.length > 128 || id.includes('/') || id === '.' || id === '..') {
    fail('invalid-argument', `A valid ${label} is required.`)
  }
  return id
}

/** A client-generated Firestore auto-ID (used so the client can watch progress on that document). */
function requireClientDocumentId(value, label) {
  if (typeof value !== 'string' || !AUTO_ID_PATTERN.test(value)) {
    fail('invalid-argument', `A valid ${label} is required.`)
  }
  return value
}

function requireCandidateIds(value) {
  const { minScreeningCandidates: min, maxScreeningCandidates: max } = LIMITS
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail('invalid-argument', `Select between ${min} and ${max} candidates.`)
  }
  const ids = value.map(id => requireDocumentId(id, 'candidate ID'))
  if (new Set(ids).size !== ids.length) {
    fail('invalid-argument', 'Each selected candidate must be unique.')
  }
  return ids
}

function requireApiKey(value) {
  if (typeof value !== 'string') fail('invalid-argument', 'A Gemini API key is required.')
  const apiKey = value.trim()
  if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
    fail('invalid-argument', 'Enter a complete Gemini API key.')
  }
  return apiKey
}

function normalizeQuestionType(type) {
  return LEGACY_INTERVIEW_QUESTION_TYPES[type] || type
}

function requireInterviewConfiguration(value) {
  const lengthMinutes = Number(value?.lengthMinutes)
  if (!INTERVIEW_LENGTHS[lengthMinutes]) {
    fail('invalid-argument', 'Choose a 30, 45, or 60 minute interview.')
  }

  const seniority = typeof value?.seniority === 'string' ? value.seniority.trim() : ''
  if (!INTERVIEW_SENIORITIES.includes(seniority)) {
    fail('invalid-argument', 'Choose Junior, Mid, or Senior.')
  }

  const questionTypes = Array.isArray(value?.questionTypes)
    ? [...new Set(value.questionTypes.map(normalizeQuestionType))]
    : []
  if (!questionTypes.length || questionTypes.some(type => !INTERVIEW_QUESTION_TYPES.includes(type))) {
    fail('invalid-argument', 'Select at least one supported question type.')
  }

  const topics = uniqueTextItems(Array.isArray(value?.topics) ? value.topics : [], 15)
  if (!topics.length) fail('invalid-argument', 'Add at least one job-related interview topic.')
  const questionCount = INTERVIEW_LENGTHS[lengthMinutes].questionCount
  if (topics.length > questionCount) {
    fail('invalid-argument', `Choose no more than ${questionCount} topics for this interview length.`)
  }

  const additionalInstructions = typeof value?.additionalInstructions === 'string'
    ? value.additionalInstructions.trim().slice(0, 1500)
    : ''

  return { lengthMinutes, seniority, questionTypes, topics, additionalInstructions }
}

const SPEAKER_ROLES = ['interviewer', 'candidate', 'other']

function requireTranscriptInput(value) {
  const transcript = cleanMultilineText(value?.transcript, LIMITS.transcriptMaxChars + 1)
  if (transcript.length < LIMITS.transcriptMinChars) {
    fail('invalid-argument', `Paste the full interview transcript (at least ${LIMITS.transcriptMinChars} characters).`)
  }
  if (transcript.length > LIMITS.transcriptMaxChars) {
    fail('invalid-argument', `The transcript is too long. Keep it under ${LIMITS.transcriptMaxChars.toLocaleString('en-GB')} characters.`)
  }

  const speakerRoles = {}
  const rawRoles = value?.speakerRoles && typeof value.speakerRoles === 'object' ? value.speakerRoles : {}
  for (const [label, role] of Object.entries(rawRoles).slice(0, 12)) {
    const cleanLabel = cleanText(label, 40)
    if (cleanLabel && SPEAKER_ROLES.includes(role)) speakerRoles[cleanLabel] = role
  }
  if (!Object.values(speakerRoles).includes('candidate')) {
    fail('invalid-argument', 'Identify which speaker is the candidate.')
  }

  return {
    transcript,
    speakerRoles,
    notes: cleanMultilineText(value?.notes, LIMITS.recruiterNotesMaxChars),
    redactContacts: value?.redactContacts !== false,
  }
}

function requireDecisionInput(value) {
  const decision = typeof value?.decision === 'string' ? value.decision : ''
  if (!DECISIONS[decision]) fail('invalid-argument', 'Choose a valid hiring decision.')
  const reason = cleanMultilineText(value?.reason, LIMITS.decisionReasonMaxChars)
  return { decision, reason }
}

function requirePositiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) fail('invalid-argument', `A valid ${label} is required.`)
  return number
}

module.exports = {
  AUTO_ID_PATTERN,
  requireDocumentId,
  requireClientDocumentId,
  requireCandidateIds,
  requireApiKey,
  requireInterviewConfiguration,
  requireTranscriptInput,
  requireDecisionInput,
  requirePositiveInteger,
  normalizeQuestionType,
}
