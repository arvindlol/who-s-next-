import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import Backdrop from './components/Backdrop.jsx'
import Auth from './pages/Auth.jsx'
import Home from './pages/Home.jsx'

function Private({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <Backdrop />
      <Routes>
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/signup" element={<Auth mode="signup" />} />
        <Route path="/" element={<Private><Home /></Private>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
