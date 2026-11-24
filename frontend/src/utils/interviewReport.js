const LEGACY_DECISION_LABELS = {
  offer: 'Move to offer',
  another: 'Another interview',
  reject: 'Do not progress',
}

const LEGACY_DECISION_VALUES = {
  'Move to offer': 'offer',
  'Move to next stage': 'another',
  'Another interview': 'another',
  'Do not progress': 'reject',
}

export function legacyDecisionLabel(value) {
  return LEGACY_DECISION_LABELS[value] || value
}

function decisionValue(label) {
  return LEGACY_DECISION_VALUES[label] || label
}

function normalizeLegacyDecision(humanDecision) {
  if (!humanDecision?.decision) return null
  const value = decisionValue(humanDecision.decision)
  return {
    value,
    label: LEGACY_DECISION_LABELS[value] || humanDecision.decision,
    reason: humanDecision.note || '',
    decidedBy: humanDecision.recordedBy || '',
    decidedByName: 'Recruiter',
    decidedAt: humanDecision.recordedAt || null,
  }
}

/**
 * The deployed report Functions use the earlier nested `report` document shape.
 * Convert it to the current page model while leaving current-format documents alone.
 */
export function normalizeInterviewReportDocument(document) {
  if (!document?.report) return document

  const legacy = document.report
  const decision = normalizeLegacyDecision(document.humanDecision)
  const plannedQuestions = Number(legacy.planCoverage?.total || legacy.questions?.length || 0)
  const askedQuestions = Number(legacy.planCoverage?.covered
    ?? legacy.questions?.filter(question => question.status !== 'not_covered').length
    ?? 0)

  return {
    ...document,
    overallScore: legacy.overallScore ?? null,
    suggestion: {
      label: legacy.aiSuggestion?.decision || 'Review required',
      note: legacy.aiSuggestion?.reason || '',
    },
    plannedQuestions,
    askedQuestions,
    evidenceStrength: {
      level: legacy.evidenceStrength?.level || 'Not assessed',
      note: legacy.evidenceStrength?.reason || '',
    },
    summary: legacy.summary || '',
    areaScores: (legacy.scoresByArea || []).map(area => ({
      area: area.area,
      score: area.score ?? null,
    })),
    questions: (legacy.questions || []).map(question => ({
      questionId: String(question.number),
      number: question.number,
      topic: question.topic || question.area || 'Interview question',
      asked: question.status !== 'not_covered',
      score: question.score ?? null,
      evidence: question.whatTheySaid || (question.status === 'not_covered' ? 'This planned question was not covered.' : ''),
      quote: question.evidenceQuotes?.[0] || '',
    })),
    strengths: (legacy.strengths || []).map(item => ({
      title: item.title,
      text: item.description || '',
      quote: item.quote || '',
      questionNumber: item.question || null,
    })),
    concerns: (legacy.concerns || []).map(item => ({
      title: item.title,
      text: item.explanation || '',
      followUpQuestion: item.suggestedFollowUp || '',
    })),
    decision,
    decisionHistory: decision ? [decision] : [],
  }
}

export function normalizeTranscriptDocument(document) {
  if (!document) return document
  return {
    ...document,
    notes: document.notes ?? document.interviewerNotes ?? '',
    redacted: document.redacted ?? document.removeContactDetails ?? true,
  }
}
