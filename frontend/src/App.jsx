{/*import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import Backdrop from './components/Backdrop.jsx'
import Auth from './pages/Auth.jsx'
import Home from './pages/Home.jsx'
import Homepage from "./pages/Homepage";

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
        <Route path="" element={<Navigate to="/login" replace />}/>
      </Routes>
    </AuthProvider>
  )
}
*/}



import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.jsx";

import Backdrop from "./components/Backdrop.jsx";
import Auth from "./pages/Auth.jsx";
import Home from "./pages/Home.jsx";
import Homepage from "./pages/Homepage.jsx";

function Private({ children }) {
  const { user } = useAuth();

  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Backdrop />

      <Routes>
        {/* Login */}
        <Route
          path="/login"
          element={<Auth mode="login" />}
        />

        {/* Signup */}
        <Route
          path="/signup"
          element={<Auth mode="signup" />}
        />

        {/* Your new homepage after login */}
        <Route
          path="/homepage"
          element={
            <Private>
              <Homepage />
            </Private>
          }
        />

        {/* Original homepage - kept unchanged */}
        <Route
          path="/"
          element={<Home />}
        />

        {/* Any unknown URL */}
        <Route
          path="*"
          element={<Navigate to="/login" replace />}
        />
      </Routes>
    </AuthProvider>
  );
}