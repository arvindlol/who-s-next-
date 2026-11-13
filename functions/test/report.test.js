'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeInterviewPlan } = require('../src/lib/plan')
const { normalizeFinalReport } = require('../src/lib/report')
const { mockPlan, mockReport } = require('../src/gemini/mock')

const configuration = {
  lengthMinutes: 30,
  seniority: 'Mid',
  questionTypes: ['role_skill'],
  topics: ['Scheduling', 'Confidentiality'],
  additionalInstructions: '',
}
const plan = normalizeInterviewPlan(mockPlan(configuration, 'Daniel'), configuration)
const transcript = [
  'Interviewer: Thanks for joining. How do you manage diaries?',
  'Candidate: I colour-code by priority and confirm anything external 24 hours ahead. It keeps four managers on track.',
  'Interviewer: How do you handle confidential files?',
  'Candidate: I hand them over in person or send them password-protected.',
].join('\n')

test('every plan question appears once; area and overall scores are computed', () => {
  const report = normalizeFinalReport(mockReport(plan, transcript), plan, transcript)

  assert.equal(report.questions.length, 8)
  assert.equal(report.plannedQuestions, 8)
  assert.ok(report.askedQuestions < 8, 'mock leaves some questions un-asked')
  assert.deepEqual(report.areaScores.map(area => area.area), ['Scheduling', 'Confidentiality'])
  assert.ok(report.areaScores.every(area => area.score === null || (area.score >= 1 && area.score <= 5)))
  assert.equal(typeof report.overallScore, 'number')
})

test('quotes that are not in the transcript are removed', () => {
  const report = normalizeFinalReport(mockReport(plan, transcript), plan, transcript)
  assert.equal(report.questions[0].quote, 'I colour-code by priority and confirm anything external 24 hours ahead.')
  assert.ok(report.questions.slice(1).every(question => question.quote === ''), 'invented quotes dropped')
  assert.equal(report.strengths[0].quote, 'I colour-code by priority and confirm anything external 24 hours ahead.')
})

test('invalid labels fall back to values derived from the evidence', () => {
  const raw = mockReport(plan, transcript)
  raw.suggestion.label = 'Hire immediately!'
  raw.evidenceStrength.level = 'Excellent'
  raw.questions[0].score = 9
  const report = normalizeFinalReport(raw, plan, transcript)

  assert.ok(['Move to next stage', 'Hold for further review', 'Do not progress'].includes(report.suggestion.label))
  assert.ok(['High', 'Medium', 'Low'].includes(report.evidenceStrength.level))
  assert.equal(report.questions[0].score, null, 'out-of-range score becomes null')
  assert.equal(report.questions[0].asked, true)
})

test('a report without a summary is rejected', () => {
  const raw = mockReport(plan, transcript)
  raw.summary = ''
  assert.throws(() => normalizeFinalReport(raw, plan, transcript), /summary/)
})
