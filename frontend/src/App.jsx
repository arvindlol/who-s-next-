import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import Backdrop from './components/Backdrop.jsx'
import Auth from './pages/Auth.jsx'
import Home from './pages/Home.jsx'
import JobsPage from './pages/JobsPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import ScreeningPage from './pages/ScreeningPage.jsx'
import ScreeningReportPage from './pages/ScreeningReportPage.jsx'

function AuthLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div className="pill pill--live">
        <span className="dot" />
        <span>Loading Who’s Next…</span>
      </div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AuthLoading />
  return user ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AuthLoading />
  return user ? <Navigate to="/" replace /> : children
}

export default function App() {
  return (
    <AuthProvider>
      <Backdrop />
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <Auth mode="login" />
            </PublicRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicRoute>
              <Auth mode="signup" />
            </PublicRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/jobs"
          element={
            <ProtectedRoute>
              <JobsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/screening"
          element={
            <ProtectedRoute>
              <ScreeningPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/screening/:screeningId/report/:candidateId"
          element={
            <ProtectedRoute>
              <ScreeningReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
