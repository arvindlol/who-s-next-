'use strict'

// Central configuration. Values that differ per environment come from functions/.env
// (see functions/.env.example). Nothing here requires a Firebase dependency.

const env = process.env

const REGION = 'asia-south1'

const MODELS = {
  screening: env.GEMINI_SCREENING_MODEL || 'gemini-3.8-flash',
  interview: env.GEMINI_INTERVIEW_MODEL || 'gemini-3.7-flash',
  report: env.GEMINI_REPORT_MODEL || env.GEMINI_INTERVIEW_MODEL || 'gemini-3.7-flash',
}

// Mock Gemini is only possible inside the Functions emulator, never in production.
const USE_GEMINI_MOCK = env.FUNCTIONS_EMULATOR === 'true' && env.GEMINI_MOCK === 'true'

// Turn on after App Check is configured in the Firebase console (functions/.env).
const ENFORCE_APP_CHECK = env.ENFORCE_APP_CHECK === 'true'

const GEMINI = {
  baseUrl: 'https://generativelanguage.googleapis.com',
  keyCheckTimeoutMs: 10_000,
  generationTimeoutMs: 120_000,
  maxAttempts: 4,
  retryDelaysMs: [2_000, 5_000, 10_000],
  retryableStatuses: new Set([500, 502, 503, 504]),
  // Above this combined PDF size, documents go through the Gemini Files API instead of inline data.
  inlinePdfLimitBytes: 14 * 1024 * 1024,
}

const LIMITS = {
  maxPdfBytes: 10 * 1024 * 1024,
  minScreeningCandidates: 1,
  maxScreeningCandidates: 5,
  transcriptMinChars: 200,
  transcriptMaxChars: 200_000,
  recruiterNotesMaxChars: 3_000,
  decisionReasonMaxChars: 2_000,
  softDeleteRetentionMs: 24 * 60 * 60 * 1000,
  diagnosticsRetentionMs: 30 * 24 * 60 * 60 * 1000,
}

// Per user, per rolling window.
const RATE_LIMITS = {
  apiKey: { limit: 20, windowMs: 60 * 60 * 1000 },
  screening: { limit: 20, windowMs: 60 * 60 * 1000 },
  interviewPlan: { limit: 30, windowMs: 60 * 60 * 1000 },
  finalReport: { limit: 30, windowMs: 60 * 60 * 1000 },
}

const INTERVIEW_LENGTHS = {
  30: { questionCount: 8 },
  45: { questionCount: 11 },
  60: { questionCount: 15 },
}

const INTERVIEW_SENIORITIES = ['Junior', 'Mid', 'Senior']
const INTERVIEW_QUESTION_TYPES = ['role_skill', 'situational', 'behavioural', 'knowledge', 'values']
const LEGACY_INTERVIEW_QUESTION_TYPES = {
  role_skills: 'role_skill',
  behavioral: 'behavioural',
  work_approach: 'values',
}

const PROMPT_VERSIONS = {
  screening: 'screening-v3',
  interviewPlan: 'interview-plan-v3',
  finalReport: 'final-report-v1',
}

module.exports = {
  REGION,
  MODELS,
  USE_GEMINI_MOCK,
  ENFORCE_APP_CHECK,
  GEMINI,
  LIMITS,
  RATE_LIMITS,
  INTERVIEW_LENGTHS,
  INTERVIEW_SENIORITIES,
  INTERVIEW_QUESTION_TYPES,
  LEGACY_INTERVIEW_QUESTION_TYPES,
  PROMPT_VERSIONS,
}
