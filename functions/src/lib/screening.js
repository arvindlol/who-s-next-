'use strict'

const { fail } = require('./appError')
const { cleanText, textList } = require('./text')
const { clampInt, sum } = require('./numbers')

const BREAKDOWN_LIMITS = Object.freeze({
  requiredSkills: 35,
  relevantExperience: 35,
  roleSimilarity: 20,
  preferredSkills: 10,
})

const MATCH_LEVELS = ['Excellent Match', 'Strong Match', 'Moderate Match', 'Weak Match', 'Poor Match']

function matchLevelForScore(score) {
  if (score >= 90) return 'Excellent Match'
  if (score >= 75) return 'Strong Match'
  if (score >= 60) return 'Moderate Match'
  if (score >= 40) return 'Weak Match'
  return 'Poor Match'
}

function recommendationForScore(score) {
  if (score >= 90) return 'Strongly Recommend'
  if (score >= 75) return 'Recommend'
  if (score >= 60) return 'Consider'
  return 'Not Recommended'
}

// Highest score first; ties broken by the scoring components in order of importance,
// then by the model's own rank, then alphabetically — so the order is always deterministic.
function compareResults(first, second) {
  return second.matchScore - first.matchScore
    || second.scoreBreakdown.requiredSkills - first.scoreBreakdown.requiredSkills
    || second.scoreBreakdown.relevantExperience - first.scoreBreakdown.relevantExperience
    || second.scoreBreakdown.roleSimilarity - first.scoreBreakdown.roleSimilarity
    || second.scoreBreakdown.preferredSkills - first.scoreBreakdown.preferredSkills
    || first.modelRank - second.modelRank
    || first.candidateName.localeCompare(second.candidateName)
}

/**
 * Summary block derived from ranked results. `supplied` carries the model's free-text parts
 * (overview, common strengths/gaps); counts and the best candidate are always recomputed.
 */
function summarizeScreening(results, supplied = {}) {
  const counts = {
    excellentMatches: 0,
    strongMatches: 0,
    moderateMatches: 0,
    weakMatches: 0,
    poorMatches: 0,
  }
  const countKeys = {
    'Excellent Match': 'excellentMatches',
    'Strong Match': 'strongMatches',
    'Moderate Match': 'moderateMatches',
    'Weak Match': 'weakMatches',
    'Poor Match': 'poorMatches',
  }
  results.forEach(result => { counts[countKeys[result.matchLevel]] += 1 })

  const best = results[0] || null
  const atLeastModerate = counts.excellentMatches + counts.strongMatches + counts.moderateMatches
  const generatedOverview = results.length
    ? `${atLeastModerate} of ${results.length} candidate${results.length === 1 ? '' : 's'} show at least a moderate fit for this role. Review the individual reports before deciding who to interview.`
    : 'No candidates remain in this screening.'

  return {
    totalCandidates: results.length,
    ...counts,
    bestCandidateId: best?.candidateId || null,
    bestCandidate: best?.candidateName || null,
    bestCandidateScore: best?.matchScore ?? null,
    overview: cleanText(supplied.overview, 1500) || generatedOverview,
    commonStrengths: results.length > 1 ? textList(supplied.commonStrengths, 8) : [],
    commonGaps: results.length > 1 ? textList(supplied.commonGaps, 8) : [],
  }
}

/**
 * Validates and repairs a Gemini screening response.
 * `candidates` = [{ id, name }] in the order they were sent.
 * Throws AppError('data-loss') only for structural problems that a retry can fix.
 */
function normalizeScreeningResult(raw, candidates) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.candidates)) {
    fail('data-loss', 'Gemini returned an incomplete screening result.')
  }

  const expected = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const returned = new Map()
  raw.candidates.forEach((item, index) => {
    const id = typeof item?.candidateId === 'string' ? item.candidateId.trim() : ''
    if (expected.has(id) && !returned.has(id)) returned.set(id, { item, index })
  })

  const missing = candidates.filter(candidate => !returned.has(candidate.id))
  if (missing.length) {
    fail('data-loss', `Gemini did not return a result for ${missing.length === 1 ? 'one of the candidates' : `${missing.length} candidates`}.`)
  }

  const results = candidates.map(candidate => {
    const { item, index } = returned.get(candidate.id)
    const breakdown = item.scoreBreakdown
    if (!breakdown || typeof breakdown !== 'object') {
      fail('data-loss', 'Gemini returned a candidate without a score breakdown.')
    }

    const scoreBreakdown = {}
    for (const [field, maximum] of Object.entries(BREAKDOWN_LIMITS)) {
      scoreBreakdown[field] = clampInt(breakdown[field], 0, maximum)
    }
    const matchScore = sum(Object.values(scoreBreakdown))

    const summary = cleanText(item.summary, 1200)
    if (!summary) fail('data-loss', 'Gemini returned a candidate without a summary.')

    const skills = item.skills && typeof item.skills === 'object' ? item.skills : {}
    const modelRank = Number.isInteger(item.rank) ? item.rank : index + 1

    return {
      candidateId: candidate.id,
      // The name recorded in the app is authoritative; the model's reading is only a fallback.
      candidateName: cleanText(candidate.name, 120) || cleanText(item.candidateName, 120) || 'Unnamed candidate',
      matchScore,
      scoreBreakdown,
      matchLevel: matchLevelForScore(matchScore),
      recommendation: recommendationForScore(matchScore),
      experienceMatch: cleanText(item.experienceMatch, 800) || 'Not mentioned in resume',
      skills: {
        matched: textList(skills.matched),
        missingMandatory: textList(skills.missingMandatory),
        missingPreferred: textList(skills.missingPreferred),
      },
      strengths: textList(item.strengths, 8),
      concerns: textList(item.concerns, 8),
      summary,
      modelRank,
    }
  })

  results.sort(compareResults)
  const ranked = results.map(({ modelRank, ...result }, index) => ({ ...result, rank: index + 1 }))

  return {
    candidates: ranked,
    screeningSummary: summarizeScreening(ranked, raw.screeningSummary || {}),
  }
}

module.exports = {
  BREAKDOWN_LIMITS,
  MATCH_LEVELS,
  matchLevelForScore,
  recommendationForScore,
  summarizeScreening,
  normalizeScreeningResult,
}
