import { scoreTone } from '../utils/format.js'

export function resultScore(result) {
  return Number(result?.matchScore ?? result?.score ?? 0)
}

function List({ items, empty }) {
  return Array.isArray(items) && items.length > 0
    ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
    : <p className="report-empty">{empty}</p>
}

/** One candidate's screening report. `headingLevel` lets the standalone page use an <h1>. */
export default function ScreeningReportView({ jobTitle, result, headingLevel = 'h2' }) {
  const score = resultScore(result)
  const breakdown = result.scoreBreakdown || {}
  const skills = result.skills || {}
  const Heading = headingLevel

  return (
    <div className="screening-candidate-report">
      <div className="screening-report__heading">
        <div>
          <span className="eyebrow">Candidate screening report</span>
          <Heading>{result.candidateName || result.name}</Heading>
          <p>{jobTitle} · {result.resumeName || 'Uploaded resume'}</p>
        </div>
        <div className={`report-score report-score--${scoreTone(score)}`}>
          <b>{score}</b><span>Match score</span>
        </div>
      </div>

      <div className="report-summary">
        <span>{result.matchLevel}</span>
        <b>{result.recommendation}</b>
        <p>{result.summary}</p>
      </div>

      <section className="report-breakdown">
        <h3>Score breakdown</h3>
        <div>
          <article><b>{breakdown.requiredSkills ?? 0}<small>/35</small></b><span>Required skills</span></article>
          <article><b>{breakdown.relevantExperience ?? 0}<small>/35</small></b><span>Relevant experience</span></article>
          <article><b>{breakdown.roleSimilarity ?? 0}<small>/20</small></b><span>Role similarity</span></article>
          <article><b>{breakdown.preferredSkills ?? 0}<small>/10</small></b><span>Preferred skills</span></article>
        </div>
      </section>

      <section className="report-experience">
        <h3>Experience match</h3>
        <p>{result.experienceMatch}</p>
      </section>

      <div className="report-grid">
        <section><h2>Matched skills</h2><List items={skills.matched} empty="No matched skills were identified." /></section>
        <section><h2>Missing mandatory skills</h2><List items={skills.missingMandatory} empty="No mandatory skills were identified as missing." /></section>
        <section><h2>Missing preferred skills</h2><List items={skills.missingPreferred} empty="No preferred skills were identified as missing." /></section>
        <section><h2>Key strengths</h2><List items={result.strengths} empty="No additional strengths were identified." /></section>
        <section className="report-grid__wide"><h2>Concerns</h2><List items={result.concerns} empty="No specific concerns were identified." /></section>
      </div>
    </div>
  )
}
