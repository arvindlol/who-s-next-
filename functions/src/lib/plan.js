'use strict'

const { fail } = require('./appError')
const { cleanText, textList, words } = require('./text')
const { clampInt, sum } = require('./numbers')
const { normalizeQuestionType } = require('./validation')
const { INTERVIEW_LENGTHS } = require('../config')

const PLAN_SCHEMA_VERSION = 3

/** Planned question time must leave 5–10 % of the slot for introductions and candidate questions. */
function minuteWindow(lengthMinutes) {
  return [Math.ceil(lengthMinutes * 0.9), Math.floor(lengthMinutes * 0.95)]
}

/** Maps a model-supplied topic onto one of the recruiter's topics (exact, contained, or word overlap). */
function matchTopic(rawTopic, topics) {
  const text = cleanText(rawTopic, 180).toLowerCase()
  if (!text) return null

  const exact = topics.find(topic => topic.toLowerCase() === text)
  if (exact) return exact

  const contained = topics.find(topic => {
    const lower = topic.toLowerCase()
    return text.includes(lower) || lower.includes(text)
  })
  if (contained) return contained

  const textWords = new Set(words(text))
  let best = null
  let bestScore = 0
  for (const topic of topics) {
    const topicWords = new Set(words(topic))
    const shared = [...topicWords].filter(word => textWords.has(word)).length
    const union = new Set([...topicWords, ...textWords]).size || 1
    const score = shared / union
    if (score > bestScore) {
      best = topic
      bestScore = score
    }
  }
  return bestScore >= 0.5 ? best : null
}

/**
 * Adjusts per-question minutes (each kept within [floor, ceiling]) until the total falls inside
 * [minimum, maximum]. Changes the smallest/largest questions first so the plan's shape is kept.
 */
function rebalanceMinutes(minutes, minimum, maximum, floor = 2, ceiling = 5) {
  const result = [...minutes]
  let total = sum(result)

  while (total < minimum) {
    let index = -1
    result.forEach((value, i) => {
      if (value < ceiling && (index === -1 || value < result[index])) index = i
    })
    if (index === -1) break
    result[index] += 1
    total += 1
  }

  while (total > maximum) {
    let index = -1
    result.forEach((value, i) => {
      if (value > floor && (index === -1 || value > result[index])) index = i
    })
    if (index === -1) break
    result[index] -= 1
    total -= 1
  }

  return result
}

/**
 * Builds the stored plan from ordered sections of questions that already carry stable `id`s.
 * Numbers, totals, topic coverage and resume-point links are always recomputed here.
 */
function finalizePlan({ title, sections, resumePoints, topics }) {
  let number = 0
  const finalSections = sections
    .filter(section => section.questions.length > 0)
    .map(section => ({
      name: section.name,
      questions: section.questions.map(question => {
        number += 1
        return { ...question, number }
      }),
    }))

  const questions = finalSections.flatMap(section => section.questions)
  const numberById = new Map(questions.map(question => [question.id, question.number]))

  const topicCoverage = topics.map(topic => {
    const matching = questions.filter(question => question.topic === topic)
    return {
      topic,
      questionCount: matching.length,
      questionNumbers: matching.map(question => question.number),
    }
  })

  const resumePointsToProbe = resumePoints
    .map(point => {
      const questionIds = point.questionIds.filter(id => numberById.has(id))
      return {
        point: point.point,
        questionIds,
        questionNumbers: questionIds.map(id => numberById.get(id)).sort((a, b) => a - b),
      }
    })
    .filter(point => point.point)

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    title,
    totalQuestions: questions.length,
    totalMinutes: sum(questions.map(question => question.minutes)),
    sections: finalSections,
    resumePointsToProbe,
    topicCoverage,
    allTopicsCovered: topicCoverage.every(item => item.questionCount > 0),
  }
}

/** Validates and repairs a generated interview plan (Gemini's snake_case JSON). */
function normalizeInterviewPlan(raw, configuration, { candidateName = '' } = {}) {
  const expected = INTERVIEW_LENGTHS[configuration.lengthMinutes].questionCount
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections) || raw.sections.length === 0) {
    fail('data-loss', 'Gemini returned an interview plan without sections.')
  }

  const drafts = []
  raw.sections.forEach((section, sectionIndex) => {
    const sectionName = cleanText(section?.name, 180) || `Section ${sectionIndex + 1}`
    const questions = Array.isArray(section?.questions) ? section.questions : []
    questions.forEach(question => {
      const wording = cleanText(question?.question, 800)
      if (!wording) fail('data-loss', 'Gemini returned a question without wording.')

      const topic = matchTopic(question?.topic, configuration.topics)
      if (!topic) fail('data-loss', 'Gemini returned a question outside the selected topics.')

      const goodAnswerCovers = textList(question?.good_answer_covers ?? question?.goodAnswerCovers, 4, 400)
      if (goodAnswerCovers.length === 0) fail('data-loss', 'Gemini returned a question without an answer guide.')

      let type = normalizeQuestionType(question?.type)
      if (!configuration.questionTypes.includes(type)) type = configuration.questionTypes[0]

      drafts.push({
        sectionName,
        originalNumber: Number(question?.number) || drafts.length + 1,
        topic,
        type,
        minutes: clampInt(question?.minutes, 2, 5, 3),
        question: wording,
        goodAnswerCovers,
        followUp: cleanText(question?.follow_up ?? question?.followUp, 500),
        watchOutFor: cleanText(question?.watch_out_for ?? question?.watchOutFor, 400),
      })
    })
  })

  if (drafts.length < expected) {
    fail('data-loss', `Gemini returned ${drafts.length} questions; ${expected} are needed.`)
  }

  // Too many questions: drop the last ones whose topic is still covered elsewhere.
  while (drafts.length > expected) {
    let removeIndex = -1
    for (let i = drafts.length - 1; i >= 0; i -= 1) {
      if (drafts.filter(draft => draft.topic === drafts[i].topic).length > 1) {
        removeIndex = i
        break
      }
    }
    if (removeIndex === -1) fail('data-loss', 'Gemini returned more questions than topics allow.')
    drafts.splice(removeIndex, 1)
  }

  const uncovered = configuration.topics.filter(topic => !drafts.some(draft => draft.topic === topic))
  if (uncovered.length) {
    fail('data-loss', `Gemini did not cover every selected topic (missing: ${uncovered.join(', ')}).`)
  }

  const [minimumMinutes, maximumMinutes] = minuteWindow(configuration.lengthMinutes)
  const minutes = rebalanceMinutes(drafts.map(draft => draft.minutes), minimumMinutes, maximumMinutes)

  const idByOriginalNumber = new Map()
  const sections = []
  drafts.forEach((draft, index) => {
    const id = `q${index + 1}`
    if (!idByOriginalNumber.has(draft.originalNumber)) idByOriginalNumber.set(draft.originalNumber, id)

    let section = sections.find(item => item.name === draft.sectionName)
    if (!section) {
      section = { name: draft.sectionName, questions: [] }
      sections.push(section)
    }

    const { sectionName, originalNumber, ...question } = draft
    section.questions.push({ ...question, id, minutes: minutes[index] })
  })

  const rawPoints = Array.isArray(raw.resume_points_to_probe ?? raw.resumePointsToProbe)
    ? (raw.resume_points_to_probe ?? raw.resumePointsToProbe)
    : []
  const resumePoints = rawPoints.slice(0, 4).map(item => {
    const numbers = Array.isArray(item?.question_numbers ?? item?.questionNumbers ?? item?.linked_questions)
      ? (item.question_numbers ?? item.questionNumbers ?? item.linked_questions)
      : []
    return {
      point: cleanText(item?.point, 500),
      questionIds: [...new Set(numbers.map(number => idByOriginalNumber.get(Number(number))).filter(Boolean))],
    }
  })

  return finalizePlan({
    title: cleanText(raw.title, 240) || `Interview plan · ${candidateName || 'Candidate'}`,
    sections,
    resumePoints,
    topics: configuration.topics,
  })
}

/**
 * Applies recruiter edits to an existing plan. Only text, minutes, order, section names and
 * removals are allowed — topics and types of existing questions are kept, and no new questions
 * can be invented on the client.
 */
function applyPlanEdits(plan, editedSections, topics) {
  if (!Array.isArray(editedSections) || editedSections.length === 0 || editedSections.length > 8) {
    fail('invalid-argument', 'The edited plan must contain at least one section.')
  }

  const existing = new Map(
    (plan?.sections || []).flatMap(section => section.questions || []).map(question => [question.id, question]),
  )
  const used = new Set()

  const sections = editedSections.map((section, sectionIndex) => {
    const questions = (Array.isArray(section?.questions) ? section.questions : []).map(edit => {
      const original = existing.get(edit?.id)
      if (!original || used.has(edit.id)) fail('invalid-argument', 'The edited plan contains an unknown or repeated question.')
      used.add(edit.id)

      const question = cleanText(edit.question, 800)
      if (!question) fail('invalid-argument', `Question ${original.number} needs wording.`)
      const goodAnswerCovers = textList(edit.goodAnswerCovers, 5, 400)
      if (goodAnswerCovers.length === 0) fail('invalid-argument', `Question ${original.number} needs at least one answer-guide point.`)

      return {
        ...original,
        question,
        goodAnswerCovers,
        followUp: cleanText(edit.followUp, 500),
        watchOutFor: cleanText(edit.watchOutFor, 400),
        minutes: clampInt(edit.minutes, 1, 10, original.minutes),
      }
    })
    return {
      name: cleanText(section?.name, 180) || `Section ${sectionIndex + 1}`,
      questions,
    }
  })

  if (used.size === 0) fail('invalid-argument', 'Keep at least one question in the plan.')

  return finalizePlan({
    title: plan.title,
    sections,
    resumePoints: (plan.resumePointsToProbe || []).map(point => ({
      point: point.point,
      questionIds: Array.isArray(point.questionIds) ? point.questionIds : [],
    })),
    topics,
  })
}

/** Flat list of questions in plan order. */
function planQuestions(plan) {
  return (plan?.sections || []).flatMap(section => section.questions || [])
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  minuteWindow,
  matchTopic,
  rebalanceMinutes,
  finalizePlan,
  normalizeInterviewPlan,
  applyPlanEdits,
  planQuestions,
}
