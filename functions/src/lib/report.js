'use strict'

const { fail } = require('./appError')
const { cleanText, comparableText } = require('./text')
const { average, roundTo } = require('./numbers')
const { planQuestions } = require('./plan')

const REPORT_SCHEMA_VERSION = 1
const SUGGESTIONS = ['Move to next stage', 'Hold for further review', 'Do not progress']
const EVIDENCE_LEVELS = ['High', 'Medium', 'Low']

function scoreOrNull(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1 || number > 5) return null
  return Math.round(number)
}

function suggestionFor(overall) {
  if (overall == null) return 'Hold for further review'
  if (overall >= 3.5) return 'Move to next stage'
  if (overall >= 2.5) return 'Hold for further review'
  return 'Do not progress'
}

/**
 * Validates and repairs a generated final interview report.
 * - Every plan question appears exactly once; unknown or duplicate numbers are ignored.
 * - Quotes are kept only if they really appear in the transcript (guards against invented evidence).
 * - Area scores, overall score and coverage are computed here, never trusted from the model.
 */
function normalizeFinalReport(raw, plan, transcript) {
  if (!raw || typeof raw !== 'object') fail('data-loss', 'Gemini returned an empty report.')

  const summary = cleanText(raw.summary, 2000)
  if (!summary) fail('data-loss', 'Gemini returned a report without a summary.')

  const questionsInPlan = planQuestions(plan)
  if (questionsInPlan.length === 0) fail('failed-precondition', 'The approved plan has no questions.')

  const comparableTranscript = ` ${comparableText(transcript)} `
  const verifiedQuote = quote => {
    const text = cleanText(quote, 400).replace(/^["“']+|["”']+$/g, '')
    const comparable = comparableText(text)
    return comparable.length >= 8 && comparableTranscript.includes(` ${comparable} `) ? text : ''
  }

  const rawByNumber = new Map()
  ;(Array.isArray(raw.questions) ? raw.questions : []).forEach(item => {
    const number = Number(item?.number)
    if (Number.isInteger(number) && !rawByNumber.has(number)) rawByNumber.set(number, item)
  })

  const validNumbers = new Set(questionsInPlan.map(question => question.number))

  const questions = questionsInPlan.map(question => {
    const item = rawByNumber.get(question.number)
    // A question can be asked but not scorable (e.g. the answer was cut off): asked = true, score = null.
    const asked = Boolean(item?.asked)
    const score = asked ? scoreOrNull(item.score) : null
    return {
      questionId: question.id,
      number: question.number,
      topic: question.topic,
      question: question.question,
      asked,
      score: asked ? score : null,
      evidence: asked ? (cleanText(item.evidence, 600) || 'No clear answer recorded.') : 'Not asked in the interview.',
      quote: asked ? verifiedQuote(item.quote) : '',
    }
  })

  const topics = [...new Set(questionsInPlan.map(question => question.topic))]
  const areaScores = topics.map(topic => {
    const matching = questions.filter(question => question.topic === topic)
    const scores = matching.filter(question => question.score !== null).map(question => question.score)
    return {
      area: topic,
      score: roundTo(average(scores), 0.5),
      questionCount: matching.length,
      askedCount: scores.length,
    }
  })

  const scoredAreas = areaScores.filter(area => area.score !== null)
  const overall = average(scoredAreas.map(area => area.score))
  const overallScore = overall === null ? null : Math.round(overall * 10) / 10
  const askedQuestions = questions.filter(question => question.asked).length

  const strengths = (Array.isArray(raw.strengths) ? raw.strengths : []).slice(0, 5).map(item => ({
    title: cleanText(item?.title, 160),
    text: cleanText(item?.text, 500),
    quote: verifiedQuote(item?.quote),
    questionNumber: validNumbers.has(Number(item?.questionNumber)) ? Number(item.questionNumber) : null,
  })).filter(item => item.title)

  const concerns = (Array.isArray(raw.concerns) ? raw.concerns : []).slice(0, 5).map(item => ({
    title: cleanText(item?.title, 160),
    text: cleanText(item?.text, 500),
    followUpQuestion: cleanText(item?.followUpQuestion, 300),
  })).filter(item => item.title)

  const rawLabel = cleanText(raw.suggestion?.label, 60).toLowerCase()
  const suggestionLabel = SUGGESTIONS.find(label => label.toLowerCase() === rawLabel) || suggestionFor(overallScore)

  const quotedAnswers = questions.filter(question => question.quote).length
  const coverage = askedQuestions / questions.length
  const derivedLevel = coverage >= 0.8 && quotedAnswers >= askedQuestions / 2
    ? 'High'
    : coverage >= 0.5 ? 'Medium' : 'Low'
  const rawLevel = cleanText(raw.evidenceStrength?.level, 20).toLowerCase()
  const evidenceLevel = EVIDENCE_LEVELS.find(level => level.toLowerCase() === rawLevel) || derivedLevel

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    summary,
    overallScore,
    areaScores,
    questions,
    plannedQuestions: questions.length,
    askedQuestions,
    strengths,
    concerns,
    suggestion: {
      label: suggestionLabel,
      note: cleanText(raw.suggestion?.note, 300),
    },
    evidenceStrength: {
      level: evidenceLevel,
      note: cleanText(raw.evidenceStrength?.note, 300),
    },
  }
}

module.exports = { REPORT_SCHEMA_VERSION, SUGGESTIONS, EVIDENCE_LEVELS, normalizeFinalReport }
