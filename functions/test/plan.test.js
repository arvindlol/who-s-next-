'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeInterviewPlan, applyPlanEdits, rebalanceMinutes, matchTopic, minuteWindow, planQuestions } = require('../src/lib/plan')
const { mockPlan } = require('../src/gemini/mock')

const configuration = {
  lengthMinutes: 45,
  seniority: 'Mid',
  questionTypes: ['role_skill', 'behavioural'],
  topics: ['SQL', 'Stakeholder management', 'Python'],
  additionalInstructions: '',
}

test('minute window leaves time for introductions', () => {
  assert.deepEqual(minuteWindow(45), [41, 42])
  assert.deepEqual(minuteWindow(30), [27, 28])
  assert.deepEqual(minuteWindow(60), [54, 57])
})

test('rebalanceMinutes moves totals into the window within 2–5 minutes each', () => {
  const up = rebalanceMinutes(Array(11).fill(3), 41, 42)
  assert.ok(up.reduce((a, b) => a + b) >= 41 && up.reduce((a, b) => a + b) <= 42)
  assert.ok(up.every(value => value >= 2 && value <= 5))

  const down = rebalanceMinutes(Array(8).fill(5), 27, 28)
  assert.ok(down.reduce((a, b) => a + b) <= 28)
  assert.ok(down.every(value => value >= 2))
})

test('matchTopic tolerates case, containment and word overlap', () => {
  const topics = configuration.topics
  assert.equal(matchTopic('sql', topics), 'SQL')
  assert.equal(matchTopic('Advanced SQL queries', topics), 'SQL')
  assert.equal(matchTopic('Managing stakeholders', topics), null)
  assert.equal(matchTopic('stakeholder management skills', topics), 'Stakeholder management')
  assert.equal(matchTopic('Cooking', topics), null)
})

test('normalises a mock plan: numbering, totals, coverage and resume links', () => {
  const plan = normalizeInterviewPlan(mockPlan(configuration, 'Asha'), configuration, { candidateName: 'Asha' })
  const questions = planQuestions(plan)

  assert.equal(plan.totalQuestions, 11)
  assert.equal(questions.length, 11)
  assert.deepEqual(questions.map(q => q.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  assert.ok(plan.totalMinutes >= 41 && plan.totalMinutes <= 42, `total ${plan.totalMinutes}`)
  assert.equal(plan.allTopicsCovered, true)
  assert.deepEqual(plan.resumePointsToProbe[0].questionNumbers, [1, 2])
  assert.ok(questions.every(q => q.id && q.goodAnswerCovers.length > 0))
})

test('maps unselected question types to a selected one and trims extra questions', () => {
  const raw = mockPlan(configuration, 'Asha')
  raw.sections[0].questions[0].type = 'knowledge'
  raw.sections[1].questions.push({ ...raw.sections[1].questions[0], number: 12, topic: 'SQL' })

  const plan = normalizeInterviewPlan(raw, configuration)
  assert.equal(plan.totalQuestions, 11)
  assert.equal(planQuestions(plan)[0].type, 'role_skill')
})

test('fails when a topic is not covered or questions are missing', () => {
  const uncovered = mockPlan(configuration, 'Asha')
  uncovered.sections.forEach(section => section.questions.forEach(q => { q.topic = 'SQL' }))
  assert.throws(() => normalizeInterviewPlan(uncovered, configuration), /did not cover/)

  const short = mockPlan(configuration, 'Asha')
  short.sections[1].questions = []
  assert.throws(() => normalizeInterviewPlan(short, configuration), /questions; 11 are needed/)
})

test('applyPlanEdits keeps topics, renumbers and recomputes coverage', () => {
  const plan = normalizeInterviewPlan(mockPlan(configuration, 'Asha'), configuration)
  const sections = plan.sections.map(section => ({
    name: section.name,
    questions: section.questions.map(q => ({ ...q, topic: 'HACKED' })),
  }))
  // Remove the first question and edit the second.
  sections[0].questions.shift()
  sections[0].questions[0].question = 'Edited wording?'
  sections[0].questions[0].minutes = 9

  const edited = applyPlanEdits(plan, sections, configuration.topics)
  const questions = planQuestions(edited)
  assert.equal(edited.totalQuestions, 10)
  assert.equal(questions[0].number, 1)
  assert.equal(questions[0].question, 'Edited wording?')
  assert.equal(questions[0].minutes, 9)
  assert.ok(questions.every(q => configuration.topics.includes(q.topic)), 'topics cannot be changed by the client')
  assert.deepEqual(edited.resumePointsToProbe[0].questionNumbers, [1], 'link to the removed question is dropped')
})

test('applyPlanEdits rejects unknown or repeated questions', () => {
  const plan = normalizeInterviewPlan(mockPlan(configuration, 'Asha'), configuration)
  const first = plan.sections[0].questions[0]
  assert.throws(() => applyPlanEdits(plan, [{ name: 'S', questions: [{ ...first, id: 'q999' }] }], configuration.topics), /unknown or repeated/)
  assert.throws(() => applyPlanEdits(plan, [{ name: 'S', questions: [first, first] }], configuration.topics), /unknown or repeated/)
})
