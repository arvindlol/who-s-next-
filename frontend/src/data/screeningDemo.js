export const DEMO_CANDIDATES = [
  {
    id: 'demo-priya-sharma',
    name: 'Priya Sharma',
    resumeName: 'priya-sharma-resume.pdf',
    score: 86,
    strengths: ['Strong API design experience', 'Production experience with Python and PostgreSQL', 'Clear ownership of backend services'],
    gaps: ['Limited evidence of event-streaming experience'],
    interviewFocus: ['System design trade-offs', 'Scaling database-heavy APIs', 'Kafka or equivalent event systems'],
  },
  {
    id: 'demo-rahul-kumar',
    name: 'Rahul Kumar',
    resumeName: 'rahul-kumar-resume.pdf',
    score: 72,
    strengths: ['Solid Python fundamentals', 'Experience building REST APIs', 'Good testing practices'],
    gaps: ['Less experience owning production architecture', 'PostgreSQL optimisation is not demonstrated'],
    interviewFocus: ['Debugging production failures', 'Database indexing', 'Service ownership examples'],
  },
  {
    id: 'demo-ananya-iyer',
    name: 'Ananya Iyer',
    resumeName: 'ananya-iyer-resume.pdf',
    score: 64,
    strengths: ['Relevant computer science foundation', 'Hands-on web application experience'],
    gaps: ['Required backend experience is below the role target', 'No evidence of distributed-system design'],
    interviewFocus: ['Depth of backend contributions', 'Approach to learning unfamiliar systems', 'API and data modelling exercise'],
  },
  {
    id: 'demo-vikram-nair',
    name: 'Vikram Nair',
    resumeName: 'vikram-nair-resume.pdf',
    score: 78,
    strengths: ['Strong SQL and data modelling', 'Experience with cloud deployments', 'Relevant FastAPI work'],
    gaps: ['Testing strategy needs validation'],
    interviewFocus: ['Automated testing decisions', 'API security', 'Operational monitoring'],
  },
]

function recommendation(score) {
  if (score >= 80) return 'Strong match'
  if (score >= 70) return 'Review'
  return 'Gaps identified'
}

function resultFor(candidate, scoreOffset = 0) {
  const score = Math.max(0, Math.min(100, candidate.score + scoreOffset))
  return { ...candidate, score, recommendation: recommendation(score) }
}

export const DEMO_SCREENINGS = [
  {
    id: 'demo-screening-backend',
    jobId: 'demo-job-backend',
    jobTitle: 'Senior Backend Engineer',
    createdAt: '2026-09-24T09:30:00.000Z',
    status: 'completed',
    demo: true,
    results: [resultFor(DEMO_CANDIDATES[0]), resultFor(DEMO_CANDIDATES[1]), resultFor(DEMO_CANDIDATES[2])],
  },
  {
    id: 'demo-screening-frontend',
    jobId: 'demo-job-frontend',
    jobTitle: 'Frontend Developer',
    createdAt: '2026-09-22T12:15:00.000Z',
    status: 'completed',
    demo: true,
    results: [resultFor(DEMO_CANDIDATES[0], -8), resultFor(DEMO_CANDIDATES[3], 3)],
  },
]

const STORAGE_KEY = 'whos-next-demo-screenings'

export function getScreenings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return [...saved, ...DEMO_SCREENINGS]
  } catch {
    return DEMO_SCREENINGS
  }
}

export function saveDemoScreening(screening) {
  const current = getScreenings().filter(item => !DEMO_SCREENINGS.some(demo => demo.id === item.id))
  localStorage.setItem(STORAGE_KEY, JSON.stringify([screening, ...current]))
}

export function createDemoScreening(job, candidates) {
  const screening = {
    id: `local-screening-${Date.now()}`,
    jobId: job.id,
    jobTitle: job.title,
    createdAt: new Date().toISOString(),
    status: 'completed',
    demo: true,
    results: candidates.map((candidate, index) => resultFor(candidate, (index % 3) - 1)),
  }
  saveDemoScreening(screening)
  return screening
}

export function findScreening(screeningId) {
  return getScreenings().find(screening => screening.id === screeningId)
}
