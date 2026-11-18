'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeScreeningResult, summarizeScreening } = require('../src/lib/screening')
const { AppError } = require('../src/lib/appError')

const candidates = [
  { id: 'cand-a', name: 'Asha Rao' },
  { id: 'cand-b', name: 'Ben Cole' },
]

function rawResult(overrides = {}) {
  return {
    candidates: [
      {
        candidateId: 'cand-a',
        rank: 2,
        matchScore: 99, // wrong on purpose: must be recomputed from the breakdown
        scoreBreakdown: { requiredSkills: 20, relevantExperience: 20, roleSimilarity: 10, preferredSkills: 5 },
        matchLevel: 'Excellent Match',
        recommendation: 'Strongly Recommend',
        experienceMatch: 'Three years in similar roles.',
        skills: { matched: ['SQL', 'sql', ' Python '], missingMandatory: [], missingPreferred: ['Kafka'] },
        strengths: ['Clear ownership'],
        concerns: [],
        summary: 'Solid candidate.',
      },
      {
        candidateId: 'cand-b',
        rank: 1,
        matchScore: 10,
        scoreBreakdown: { requiredSkills: 40, relevantExperience: 30, roleSimilarity: 18, preferredSkills: 9 },
        experienceMatch: '',
        skills: { matched: ['Java'], missingMandatory: [], missingPreferred: [] },
        strengths: [],
        concerns: ['Short tenure'],
        summary: 'Strong fit.',
      },
    ],
    screeningSummary: { overview: 'Ben leads.', commonStrengths: ['x'], commonGaps: [] },
    ...overrides,
  }
}

test('recomputes scores, labels, ranks and summary instead of rejecting', () => {
  const result = normalizeScreeningResult(rawResult(), candidates)
  const [first, second] = result.candidates

  assert.equal(first.candidateId, 'cand-b')
  assert.equal(first.rank, 1)
  assert.equal(first.scoreBreakdown.requiredSkills, 35, 'clamped to the component maximum')
  assert.equal(first.matchScore, 35 + 30 + 18 + 9)
  assert.equal(first.matchLevel, 'Excellent Match')
  assert.equal(first.recommendation, 'Strongly Recommend')
  assert.equal(first.experienceMatch, 'Not mentioned in resume')

  assert.equal(second.matchScore, 55)
  assert.equal(second.matchLevel, 'Weak Match')
  assert.equal(second.recommendation, 'Not Recommended')
  assert.deepEqual(second.skills.matched, ['SQL', 'Python'], 'case-insensitive de-duplication')
  assert.equal(second.candidateName, 'Asha Rao', 'app name wins over model name')

  assert.equal(result.screeningSummary.totalCandidates, 2)
  assert.equal(result.screeningSummary.excellentMatches, 1)
  assert.equal(result.screeningSummary.weakMatches, 1)
  assert.equal(result.screeningSummary.bestCandidateId, 'cand-b')
  assert.equal(result.screeningSummary.overview, 'Ben leads.')
})

test('ignores unknown and duplicate candidate IDs but fails when one is missing', () => {
  const raw = rawResult()
  raw.candidates.push({ ...raw.candidates[0], candidateId: 'intruder' })
  raw.candidates.push({ ...raw.candidates[0] })
  assert.equal(normalizeScreeningResult(raw, candidates).candidates.length, 2)

  const missing = rawResult()
  missing.candidates.pop()
  assert.throws(() => normalizeScreeningResult(missing, candidates), error => error instanceof AppError && error.code === 'data-loss')
})

test('fails structurally without a breakdown or summary', () => {
  const noBreakdown = rawResult()
  delete noBreakdown.candidates[0].scoreBreakdown
  assert.throws(() => normalizeScreeningResult(noBreakdown, candidates), /score breakdown/)

  const noSummary = rawResult()
  noSummary.candidates[1].summary = '   '
  assert.throws(() => normalizeScreeningResult(noSummary, candidates), /summary/)
})

test('single-candidate screenings have no common strengths or gaps', () => {
  const raw = rawResult()
  raw.candidates = [raw.candidates[0]]
  const result = normalizeScreeningResult(raw, [candidates[0]])
  assert.equal(result.candidates[0].rank, 1)
  assert.deepEqual(result.screeningSummary.commonStrengths, [])
})

test('summarizeScreening handles an empty list', () => {
  const summary = summarizeScreening([])
  assert.equal(summary.totalCandidates, 0)
  assert.equal(summary.bestCandidateId, null)
})
