// Run with: npm test  (uses Node's built-in test runner; no browser or Firebase needed)
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, csvCell, buildCsv } from '../src/utils/csv.js'
import { getEmailSuggestions, normalizeEmail, normalizePhone, phoneKey, EMAIL_PATTERN } from '../src/utils/email.js'
import {
  normalizeCandidate,
  parseSkills,
  resumeStoragePath,
  validateResumeFile,
  displayFileName,
  isStale,
} from '../src/utils/candidateModel.js'
import { normalizeStage, stageTone, interviewStatusDetails, interviewStatusKey, isInterviewPending } from '../src/constants/statuses.js'
import { callableErrorMessage } from '../src/services/errorMessages.js'

test('CSV parsing handles quotes, commas, new lines and BOM', () => {
  const rows = parseCsv('﻿Name,Notes\r\n"Asha, R","Line 1\nLine ""2"""\r\nBen,')
  assert.deepEqual(rows, [['Name', 'Notes'], ['Asha, R', 'Line 1\nLine "2"'], ['Ben', '']])
})

test('CSV cells defuse spreadsheet formulas', () => {
  assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`)
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""')
  assert.ok(buildCsv([['a']]).startsWith('﻿'))
})

test('emails are never completed silently; suggestions are offered instead', () => {
  assert.equal(normalizeEmail('  Rahul@Example.COM '), 'rahul@example.com')
  assert.equal(normalizeEmail('rahul'), 'rahul', 'no @gmail.com appended')
  assert.deepEqual(getEmailSuggestions('rahul').map(item => item.value).slice(0, 2), ['rahul@gmail.com', 'rahul@outlook.com'])
  assert.deepEqual(getEmailSuggestions('rahul@company.com'), [])
  assert.equal(EMAIL_PATTERN.test('rahul'), false)
})

test('phone helpers', () => {
  assert.equal(normalizePhone('+91 98765-43210'), '+919876543210')
  assert.equal(phoneKey('+91 98765 43210'), phoneKey('98765 43210'))
})

test('legacy candidate documents are normalised', () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/resumes%2Fu1%2FAbCdEfGhIjKlMnOpQrSt-cv.pdf?alt=media&token=t'
  const candidate = normalizeCandidate('AbCdEfGhIjKlMnOpQrSt', {
    name: 'Asha',
    status: 'Interview ready',
    skills: 'React · TypeScript, react',
    resume: url,
    additionalinformation: 'Notes',
  })
  assert.equal(candidate.status, 'Interview Ready')
  assert.deepEqual(candidate.skills, ['React', 'TypeScript'])
  assert.equal(candidate.resumeUrl, url)
  assert.equal(candidate.resumePath, 'resumes/u1/AbCdEfGhIjKlMnOpQrSt-cv.pdf')
  assert.equal(candidate.resumeName, 'cv.pdf')
  assert.equal(candidate.notes, 'Notes')
  assert.equal(normalizeCandidate('x', { status: 'Selected' }).status, 'Hired')
})

test('resume paths and file validation', () => {
  assert.equal(resumeStoragePath('u1', 'cand', 'My CV (final).pdf', 1700000000000), 'resumes/u1/cand-1700000000000-My_CV_final_.pdf')
  assert.equal(displayFileName('resumes/u1/cand-1700000000000-My_CV.pdf', 'cand'), 'My_CV.pdf')
  assert.equal(validateResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 1000 }), '')
  assert.match(validateResumeFile({ name: 'cv.docx', type: '', size: 1000 }), /PDF/)
  assert.match(validateResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }), /too large/)
  assert.deepEqual(parseSkills('a; b\nA'), ['a', 'b'])
})

test('follow-up reminder skips closed stages', () => {
  const old = { status: 'Screening', updatedMs: 0 }
  assert.equal(isStale(old, 8 * 86400000), true)
  assert.equal(isStale({ ...old, status: 'Hired' }, 8 * 86400000), false)
})

test('stage and interview status helpers', () => {
  assert.equal(normalizeStage('dropped'), 'Rejected')
  assert.equal(stageTone('Hired'), 'live')
  assert.equal(interviewStatusKey('approved'), 'plan_approved')
  assert.equal(interviewStatusDetails({ id: 'i1', status: 'plan_approved' }).step, 3)
  assert.equal(interviewStatusDetails({ id: 'i1', status: 'report_ready' }).to, '/interviews/i1/report')
  assert.equal(interviewStatusDetails({ id: 'i1', status: 'decided', decision: 'reject' }).tone, 'danger')
  assert.equal(isInterviewPending('plan_ready'), true)
  assert.equal(isInterviewPending('decided'), false)
})

test('callable errors show the server message when it is safe to', () => {
  assert.equal(callableErrorMessage({ code: 'functions/failed-precondition', message: 'Job not ready.' }), 'Job not ready.')
  assert.match(callableErrorMessage({ code: 'functions/unauthenticated' }), /sign in/i)
  assert.match(callableErrorMessage({ code: 'functions/not-found', message: 'x' }, 'fallback'), /x|not deployed/)
  assert.equal(callableErrorMessage({ code: 'weird' }, 'Fallback text'), 'Fallback text')
})
