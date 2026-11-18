'use strict'

// Deterministic fake Gemini responses, used only in the Functions emulator with GEMINI_MOCK=true.
// They intentionally contain small inconsistencies (wrong totals, unsorted ranks, odd minutes)
// so the normalisers are exercised end to end.

const { INTERVIEW_LENGTHS } = require('../config')
const { planQuestions } = require('../lib/plan')

function mockScreening(candidates) {
  return {
    candidates: candidates.map((candidate, index) => ({
      candidateId: candidate.id,
      rank: index + 1,
      candidateName: candidate.name,
      matchScore: 50,
      scoreBreakdown: {
        requiredSkills: 30 - index * 6,
        relevantExperience: 28 - index * 5,
        roleSimilarity: 15 - index * 2,
        preferredSkills: 7 - index,
      },
      matchLevel: 'Strong Match',
      recommendation: 'Recommend',
      experienceMatch: `${candidate.name} has relevant experience (mock data).`,
      skills: {
        matched: ['Communication', 'Problem solving'],
        missingMandatory: index > 1 ? ['A mandatory skill'] : [],
        missingPreferred: ['A preferred skill'],
      },
      strengths: ['Clear examples of ownership (mock)'],
      concerns: ['Depth of experience needs checking (mock)'],
      summary: `Mock screening summary for ${candidate.name}.`,
    })).reverse(),
    screeningSummary: {
      overview: 'Mock screening overview generated in the emulator.',
      commonStrengths: ['Communication'],
      commonGaps: ['A preferred skill'],
    },
  }
}

function mockPlan(configuration, candidateName) {
  const count = INTERVIEW_LENGTHS[configuration.lengthMinutes].questionCount
  const questions = Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    topic: configuration.topics[index % configuration.topics.length],
    type: configuration.questionTypes[index % configuration.questionTypes.length],
    minutes: 3,
    question: `Mock question ${index + 1}: tell me about your experience with ${configuration.topics[index % configuration.topics.length]}.`,
    good_answer_covers: ['A specific example', 'Their own contribution', 'A measurable outcome'],
    follow_up: 'What would you do differently next time?',
    watch_out_for: 'Only describes the team’s work, not their own.',
  }))
  const half = Math.ceil(count / 2)
  return {
    title: `Interview plan · ${candidateName}`,
    total_questions: count,
    total_minutes: count * 3,
    sections: [
      { name: 'Experience and skills', questions: questions.slice(0, half) },
      { name: 'Judgement and working style', questions: questions.slice(half) },
    ],
    resume_points_to_probe: [
      { point: 'Verify the scale of the most recent project (mock).', question_numbers: [1, 2] },
      { point: 'Check depth in the main required skill (mock).', question_numbers: [3] },
    ],
  }
}

function mockReport(plan, transcript) {
  const firstCandidateLine = (transcript.split('\n').find(line => /^candidate\s*:/i.test(line)) || '')
    .replace(/^[^:]+:\s*/, '')
    .split(/(?<=[.!?])\s/)[0] || ''

  return {
    summary: 'Mock final report generated in the emulator. The candidate answered most planned questions with reasonable detail.',
    questions: planQuestions(plan).map((question, index) => ({
      number: question.number,
      asked: index % 5 !== 4,
      score: index % 5 === 4 ? null : 3 + (index % 3 === 0 ? 1 : 0),
      evidence: `Mock evidence for question ${question.number}.`,
      quote: index === 0 ? firstCandidateLine : 'This sentence does not appear in the transcript.',
    })),
    strengths: [{ title: 'Clear communication (mock)', text: 'Explained examples clearly.', quote: firstCandidateLine, questionNumber: 1 }],
    concerns: [{ title: 'Some topics not covered (mock)', text: 'A few planned questions were not asked.', followUpQuestion: 'Can you walk me through a recent example?' }],
    suggestion: { label: 'Move to next stage', note: 'Mock suggestion.' },
    evidenceStrength: { level: 'Medium', note: 'Mock evidence note.' },
  }
}

module.exports = { mockScreening, mockPlan, mockReport }
