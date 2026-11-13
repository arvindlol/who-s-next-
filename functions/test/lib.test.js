'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { encryptSecret, decryptSecret, parseMasterKey, interviewDocumentId } = require('../src/lib/crypto')
const { redactContactDetails } = require('../src/lib/redact')
const { applyRateLimit } = require('../src/lib/rateLimit')
const { storagePathFromValue, candidateResumePath, isOwnedResumePath, displayFileName } = require('../src/lib/storagePaths')
const { normalizeCandidateStage, nextCandidateStage } = require('../src/lib/statuses')
const validation = require('../src/lib/validation')
const { extractJson } = require('../src/gemini/response')
const { generateWithValidationRetry } = require('../src/lib/validationRetry')
const { AppError } = require('../src/lib/appError')

test('encryption round-trips and is bound to the user and version', () => {
  const key = crypto.randomBytes(32)
  const record = encryptSecret('AIza-test-key-1234567890', key, 'user-1', 2)
  assert.equal(decryptSecret(record, key, 'user-1'), 'AIza-test-key-1234567890')
  assert.throws(() => decryptSecret(record, key, 'user-2'))
  assert.throws(() => decryptSecret({ ...record, encryptionVersion: 1 }, key, 'user-1'))
  assert.throws(() => parseMasterKey('short'), /not configured/)
})

test('interview IDs keep the original format for round 1', () => {
  const legacy = crypto.createHash('sha256').update('u:j:c').digest('hex').slice(0, 32)
  assert.equal(interviewDocumentId('u', 'j', 'c'), legacy)
  assert.notEqual(interviewDocumentId('u', 'j', 'c', 2), legacy)
})

test('redaction removes emails and phone numbers but keeps times and years', () => {
  const { text, emails, phones } = redactContactDetails('Mail me at asha.rao@example.com or +91 98765 43210. At 00:12 I joined (2019-2021).')
  assert.equal(emails, 1)
  assert.equal(phones, 1)
  assert.ok(text.includes('[email removed]'))
  assert.ok(text.includes('[phone removed]'))
  assert.ok(text.includes('00:12'))
  assert.ok(text.includes('2019-2021'))
})

test('rate limit allows up to the limit per window', () => {
  const policy = { limit: 2, windowMs: 1000 }
  let state = null
  let outcome = applyRateLimit(state, 0, policy); state = outcome.state
  assert.equal(outcome.allowed, true)
  outcome = applyRateLimit(state, 10, policy); state = outcome.state
  assert.equal(outcome.allowed, true)
  outcome = applyRateLimit(state, 20, policy)
  assert.equal(outcome.allowed, false)
  assert.equal(outcome.retryAfterMs, 980)
  assert.equal(applyRateLimit(state, 1000, policy).allowed, true, 'new window')
})

test('storage paths are read from every legacy field', () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/demo/o/resumes%2Fu1%2Fabc-cv.pdf?alt=media&token=t'
  assert.equal(storagePathFromValue(url), 'resumes/u1/abc-cv.pdf')
  assert.equal(candidateResumePath({ resume: url }), 'resumes/u1/abc-cv.pdf')
  assert.equal(candidateResumePath({ resumeUrl: url, resumePath: 'resumes/u1/new.pdf' }), 'resumes/u1/new.pdf')
  assert.equal(isOwnedResumePath('resumes/u1/x.pdf', 'u1'), true)
  assert.equal(isOwnedResumePath('resumes/u1/../u2/x.pdf', 'u1'), false)
  assert.equal(isOwnedResumePath('resumes/u2/x.pdf', 'u1'), false)
  assert.equal(displayFileName('resumes/u1/abcd-1731400000000-My_CV.pdf', 'abcd'), 'My_CV.pdf')
})

test('candidate stages: legacy values and automatic moves', () => {
  assert.equal(normalizeCandidateStage('interview ready'), 'Interview Ready')
  assert.equal(normalizeCandidateStage('Selected'), 'Hired')
  assert.equal(normalizeCandidateStage('Dropped'), 'Rejected')
  assert.equal(normalizeCandidateStage(''), 'Screening')
  assert.equal(nextCandidateStage('advanced_to_interview', 'Screening'), 'Interview Pending')
  assert.equal(nextCandidateStage('advanced_to_interview', 'Hired'), null, 'never overrides a manual final stage')
  assert.equal(nextCandidateStage('plan_approved', 'Interview Pending'), 'Interview Ready')
  assert.equal(nextCandidateStage('decision', 'Interview Ready', 'reject'), 'Rejected')
})

test('input validation', () => {
  assert.throws(() => validation.requireCandidateIds([]), /between 1 and 5/)
  assert.throws(() => validation.requireCandidateIds(['a', 'a']), /unique/)
  assert.deepEqual(validation.requireCandidateIds(['a']), ['a'])
  assert.throws(() => validation.requireDocumentId('a/b', 'ID'))
  assert.throws(() => validation.requireClientDocumentId('short', 'report ID'))
  assert.equal(validation.requireClientDocumentId('AbCdEfGhIjKlMnOpQrSt', 'report ID'), 'AbCdEfGhIjKlMnOpQrSt')

  const configuration = validation.requireInterviewConfiguration({
    lengthMinutes: '30', seniority: 'Senior', questionTypes: ['behavioral', 'role_skills'], topics: ['SQL', 'sql', 'APIs'],
  })
  assert.deepEqual(configuration.questionTypes, ['behavioural', 'role_skill'])
  assert.deepEqual(configuration.topics, ['SQL', 'APIs'])

  const transcriptInput = validation.requireTranscriptInput({
    transcript: 'x'.repeat(250),
    speakerRoles: { Interviewer: 'interviewer', Asha: 'candidate', Bad: 'boss' },
  })
  assert.deepEqual(transcriptInput.speakerRoles, { Interviewer: 'interviewer', Asha: 'candidate' })
  assert.equal(transcriptInput.redactContacts, true)
  assert.throws(() => validation.requireTranscriptInput({ transcript: 'x'.repeat(250), speakerRoles: {} }), /candidate/)
  assert.throws(() => validation.requireDecisionInput({ decision: 'hire' }), /valid hiring decision/)
})

test('Gemini response parsing handles fences, thoughts, blocks and truncation', () => {
  const body = text => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'thinking' }, { text }] } }] })
  assert.deepEqual(extractJson(body('```json\n{"a":1}\n```')), { a: 1 })
  assert.throws(() => extractJson({ promptFeedback: { blockReason: 'SAFETY' } }), error => error.code === 'failed-precondition')
  assert.throws(() => extractJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }), /cut off/)
  assert.throws(() => extractJson(body('not json')), error => error.code === 'data-loss')
})

test('validation retry asks once more with a correction note', async () => {
  const notes = []
  const { value, validationAttempts } = await generateWithValidationRetry({
    generate: async correction => { notes.push(correction); return notes.length },
    normalize: raw => { if (raw === 1) throw new AppError('data-loss', 'bad shape'); return 'ok' },
    buildCorrection: problem => `fix: ${problem}`,
  })
  assert.equal(value, 'ok')
  assert.equal(validationAttempts, 2)
  assert.deepEqual(notes, ['', 'fix: bad shape'])

  await assert.rejects(generateWithValidationRetry({
    generate: async () => 1,
    normalize: () => { throw new AppError('permission-denied', 'no') },
    buildCorrection: () => '',
  }), error => error.code === 'permission-denied')
})
