import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import Backdrop from './components/Backdrop.jsx'

// Each page is loaded on first visit, so its code (and page-specific CSS) is only fetched when needed.
const Auth = lazy(() => import('./pages/Auth.jsx'))
const Home = lazy(() => import('./pages/Home.jsx'))
const JobsPage = lazy(() => import('./pages/JobsPage.jsx'))
const Candidates = lazy(() => import('./pages/Candidates.jsx'))
const ScreeningPage = lazy(() => import('./pages/ScreeningPage.jsx'))
const ScreeningReportPage = lazy(() => import('./pages/ScreeningReportPage.jsx'))
const InterviewsPage = lazy(() => import('./pages/InterviewsPage.jsx'))
const InterviewPlanPage = lazy(() => import('./pages/InterviewPlanPage.jsx'))
const InterviewPlanReviewPage = lazy(() => import('./pages/InterviewPlanReviewPage.jsx'))
const InterviewTranscriptPage = lazy(() => import('./pages/InterviewTranscriptPage.jsx'))
const InterviewReportPage = lazy(() => import('./pages/InterviewReportPage.jsx'))
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'))
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'))

function AppLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="pill pill--live"><span className="dot" /><span>Loading Who’s Next…</span></div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AppLoading />
  return user ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AppLoading />
  return user ? <Navigate to="/" replace /> : children
}

/** Old report links (/interviews/:id/reports/:candidateId) now live at /interviews/:id/report. */
function LegacyReportRedirect() {
  const { interviewId } = useParams()
  return <Navigate to={`/interviews/${interviewId}/report`} replace />
}

const protectedRoutes = [
  ['/', Home],
  ['/jobs', JobsPage],
  ['/candidates', Candidates],
  ['/screening', ScreeningPage],
  ['/screening/:screeningId/report/:candidateId', ScreeningReportPage],
  ['/interviews', InterviewsPage],
  ['/interviews/:interviewId/plan', InterviewPlanPage],
  ['/interviews/:interviewId/review', InterviewPlanReviewPage],
  ['/interviews/:interviewId/transcript', InterviewTranscriptPage],
  ['/interviews/:interviewId/report', InterviewReportPage],
  ['/reports', ReportsPage],
  ['/profile', ProfilePage],
]

export default function App() {
  return (
    <AuthProvider>
      <Backdrop />
      <Suspense fallback={<AppLoading />}>
        <Routes>
          <Route path="/login" element={<PublicRoute><Auth mode="login" /></PublicRoute>} />
          <Route path="/signup" element={<PublicRoute><Auth mode="signup" /></PublicRoute>} />
          {protectedRoutes.map(([path, Page]) => (
            <Route key={path} path={path} element={<ProtectedRoute><Page /></ProtectedRoute>} />
          ))}
          <Route path="/interviews/:interviewId/reports/:candidateId" element={<ProtectedRoute><LegacyReportRedirect /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
