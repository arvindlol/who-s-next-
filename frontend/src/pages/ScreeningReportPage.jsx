import { Navigate, useParams } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { findScreening } from '../data/screeningDemo.js'

export default function ScreeningReportPage() {
  const { screeningId, candidateId } = useParams()
  const screening = findScreening(screeningId)
  const result = screening?.results.find(candidate => candidate.id === candidateId)

  if (!screening || !result) return <Navigate to="/screening" replace />

  return (
    <div className="report-page">
      <header className="report-page__top">
        <Brand />
        <div>
          <button className="btn" onClick={() => window.close()}>Close tab</button>
          <button className="btn btn--primary" onClick={() => window.print()}>Print report</button>
        </div>
      </header>

      <main className="screening-report glass glass--strong">
        <div className="screening-report__heading">
          <div><span className="eyebrow">Candidate screening report</span><h1>{result.name}</h1><p>{screening.jobTitle} · {result.resumeName}</p></div>
          <div className={`report-score report-score--${result.score >= 80 ? 'high' : result.score >= 70 ? 'medium' : 'low'}`}><b>{result.score}</b><span>Match score</span></div>
        </div>

        <div className="report-summary">
          <span>Recommendation</span><b>{result.recommendation}</b>
          <p>This demonstration report previews the intended layout. Final findings will be generated from the uploaded resume and job description by the screening backend.</p>
        </div>

        <div className="report-grid">
          <section><h2>Matching strengths</h2><ul>{result.strengths.map(item => <li key={item}>{item}</li>)}</ul></section>
          <section><h2>Gaps to validate</h2><ul>{result.gaps.map(item => <li key={item}>{item}</li>)}</ul></section>
          <section className="report-grid__wide"><h2>Suggested interview focus</h2><ul>{result.interviewFocus.map(item => <li key={item}>{item}</li>)}</ul></section>
        </div>

        <footer className="screening-report__foot">Demo result · Generated for interface development only</footer>
      </main>
    </div>
  )
}
