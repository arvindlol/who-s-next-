process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const test = require('node:test')
const { __test } = require('./index.js')

const plan = {
  sections: [
    {
      name: 'Role skills',
      questions: [{
        number: 1,
        topic: 'Python',
        goodAnswerCovers: ['Uses Python in real work', 'Explains a measurable result'],
      }],
    },
    {
      name: 'Working style',
      questions: [{
        number: 2,
        topic: 'Teamwork',
        goodAnswerCovers: ['Communicates clearly', 'Resolves disagreement constructively'],
      }],
    },
  ],
  criticalTopics: ['Python'],
  topicCoverage: [
    { topic: 'Python', questionCount: 1 },
    { topic: 'Teamwork', questionCount: 1 },
  ],
  resumePointsToProbe: [{ point: 'Python listed without an example', questionNumbers: [1] }],
}

const transcript = [
  'Interviewer: Tell me how you have used Python at work.',
  'Candidate: I used Python to automate a weekly report and saved the team two hours each week.',
  'Interviewer: Tell me about a disagreement with a colleague.',
  'Candidate: I listened to their concern, explained the deadline, and we agreed on a smaller first release.',
].join('\n')

test('validates and normalizes a complete evidence report', () => {
  const report = __test.validateInterviewReport({
    overall_score: 3.5,
    ai_suggestion: { decision: 'Move to next stage', reason: 'Relevant evidence with one result needing more detail.' },
    plan_coverage: { covered: 2, total: 2, not_covered_questions: [] },
    evidence_strength: { level: 'High', reason: 'Both answers include specific actions.' },
    summary: 'The candidate gave relevant examples. Python evidence included a measurable result. Teamwork evidence was constructive. Confirm depth in the next stage.',
    scores_by_area: [
      { area: 'Role skills', score: 4, status: 'scored' },
      { area: 'Working style', score: 3, status: 'scored' },
    ],
    strengths: [{
      title: 'Useful automation',
      description: 'Applied Python to a recurring work task.',
      quote: 'I used Python to automate a weekly report and saved the team two hours each week.',
      question: 1,
    }],
    concerns: [],
    questions: [
      {
        number: 1,
        area: 'Role skills',
        score: 4,
        status: 'scored',
        what_they_said: 'Automated a weekly report with Python and saved time.',
        points_hit: ['Uses Python in real work', 'Explains a measurable result'],
        points_missed: [],
        evidence_quotes: ['I used Python to automate a weekly report and saved the team two hours each week.'],
      },
      {
        number: 2,
        area: 'Working style',
        score: 3,
        status: 'scored',
        what_they_said: 'Resolved a disagreement by listening and agreeing a smaller release.',
        points_hit: ['Communicates clearly', 'Resolves disagreement constructively'],
        points_missed: [],
        evidence_quotes: ['I listened to their concern, explained the deadline, and we agreed on a smaller first release.'],
      },
    ],
    critical_topic_checks: [{
      topic: 'Python',
      score: 4,
      status: 'met',
      question_numbers: [1],
      evidence_quote: 'I used Python to automate a weekly report and saved the team two hours each week.',
    }],
    resume_probe_results: [{
      point: 'Python listed without an example',
      status: 'supported',
      question_numbers: [1],
      finding: 'The candidate supplied a work example with a measurable result.',
      evidence_quote: 'I used Python to automate a weekly report and saved the team two hours each week.',
    }],
    interviewer_note_observations: [],
    data_quality_flags: [],
  }, plan, transcript)

  assert.equal(report.overallScore, 3.5)
  assert.equal(report.questions.length, 2)
  assert.equal(report.questions[0].evidenceQuotes.length, 1)
  assert.equal(report.criticalTopicChecks[0].score, 4)
})

test('requires null scores for questions that were not covered', () => {
  const singleQuestionPlan = {
    sections: [{
      name: 'Role skills',
      questions: [{
        number: 1,
        topic: 'Python',
        goodAnswerCovers: ['Uses Python in real work'],
      }],
    }],
    criticalTopics: [],
    resumePointsToProbe: [],
  }
  assert.throws(() => __test.validateInterviewReport({
    overall_score: null,
    ai_suggestion: { decision: 'Another interview', reason: 'A planned question was not covered.' },
    plan_coverage: { covered: 0, total: 1, not_covered_questions: [{ number: 1, topic: 'Python' }] },
    evidence_strength: { level: 'Low', reason: 'The planned question was not covered.' },
    summary: 'The planned question was not covered. No reliable score can be given. A follow-up interview is needed.',
    scores_by_area: [
      { area: 'Role skills', score: null, status: 'not_covered' },
    ],
    strengths: [],
    concerns: [],
    questions: [{
      number: 1,
      area: 'Role skills',
      score: 1,
      status: 'not_covered',
      what_they_said: '',
      points_hit: [],
      points_missed: [],
      evidence_quotes: [],
    }],
    critical_topic_checks: [],
    resume_probe_results: [],
    interviewer_note_observations: [],
    data_quality_flags: [],
  }, singleQuestionPlan, transcript), /null score with no evidence/i)
})

test('redacts email addresses and phone-like values before AI processing', () => {
  const redacted = __test.redactTranscriptContactDetails('Candidate: email me at person@example.com or +61 412 345 678.')
  assert.equal(redacted, 'Candidate: email me at [email removed] or [phone removed].')
})

test('converts an older flat approved plan without changing new structured plans', () => {
  const legacyPlan = {
    title: 'Older approved plan',
    questions: [{
      order: 1,
      topic: 'Python',
      estimatedMinutes: 4,
      question: 'How have you used Python at work?',
      goodAnswerIncludes: ['Uses Python in real work', 'Explains a measurable result'],
    }],
  }
  const legacyModel = __test.approvedPlanModel(legacyPlan)
  assert.equal(legacyModel.sourceFormat, 'legacy_flat')
  assert.equal(legacyModel.sections[0].area, 'Interview questions')
  assert.equal(legacyModel.questions[0].number, 1)
  assert.deepEqual(legacyModel.questions[0].goodAnswerCovers, legacyPlan.questions[0].goodAnswerIncludes)
  assert.deepEqual(legacyModel.criticalTopics, ['Python'])

  const structuredModel = __test.approvedPlanModel(plan)
  assert.equal(structuredModel.sourceFormat, 'structured')
  assert.deepEqual(structuredModel.sections.map(section => section.area), ['Role skills', 'Working style'])
  assert.deepEqual(structuredModel.criticalTopics, ['Python'])
})
