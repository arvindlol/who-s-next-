import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth'
import Brand from '../components/Brand.jsx'
import { auth } from '../firebase.js'
import { getAuthErrorMessage, useAuth } from '../auth.jsx'

const STAGES = [
  'Check Resume Fit',
  'Plan the Interview',
  'Conduct Interview',
  'Upload Transcript',
  'Get Brief Report',
]

export default function Auth({ mode }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const { user } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Clear error when toggling between login and signup
  useEffect(() => {
    setError('')
  }, [mode])

  // If already logged in, redirect to home
  useEffect(() => {
    if (user) {
      navigate('/', { replace: true })
    }
  }, [user, navigate])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setError('')

    const email = form.email.trim()
    const password = form.password
    const name = form.name.trim()

    // 1. Required field validation
    if (!email) {
      return setError('Please enter your work email.')
    }
    if (!email.includes('@')) {
      return setError('Please enter a valid email address.')
    }
    if (!password) {
      return setError('Please enter your password.')
    }

    if (!isLogin) {
      if (!name) {
        return setError('Please enter your full name.')
      }
      if (password.length < 6) {
        return setError('Password needs at least 6 characters.')
      }
      // 2. Validate Password and Confirm Password match
      if (password !== form.confirm) {
        return setError('Passwords do not match.')
      }
    }

    setBusy(true)
    try {
      if (isLogin) {
        // Sign In with Firebase Auth
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        // Sign Up with Firebase Auth
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        if (name) {
          try {
            await updateProfile(cred.user, { displayName: name })
          } catch (profileErr) {
            console.warn('Could not update profile name:', profileErr)
          }
        }
      }
      navigate('/')
    } catch (err) {
      setError(getAuthErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <section className="auth__story">
        <Brand />
        <h1>You lead the Interview. We help you prepare.</h1>
        <p>
          Who’s Next analyzes the role and candidate to help you ask better questions and turn interviews into meaningful insights.
        </p>
        <p className="auth__tagline">
          Prepare better. Ask smarter. Hire with clarity.
        </p>
        <div className="flow" aria-label="How Who's Next works">
          {STAGES.map((label, i) => (
            <span key={label} style={{ display: 'contents' }}>
              {i > 0 && <span className="arrow" aria-hidden="true">›</span>}
              <span className="node">{label}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="auth__card glass glass--strong glass--xl">
        <div className="auth__tabs" role="tablist">
          <span className={`thumb${isLogin ? '' : ' right'}`} aria-hidden="true" />
          <button role="tab" aria-selected={isLogin} onClick={() => navigate('/login')}>Log in</button>
          <button role="tab" aria-selected={!isLogin} onClick={() => navigate('/signup')}>Sign up</button>
        </div>

        <h2>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
        <p className="sub">{isLogin ? 'Pick up where you left off.' : 'Free for interviewers. No card needed.'}</p>

        <form className="auth__form" onSubmit={submit} noValidate>
          {!isLogin && (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" value={form.name} onChange={set('name')} placeholder="Priya Sharma" autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" autoComplete="email" />
          </div>
          {isLogin ? (
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" autoComplete="current-password" />
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" value={form.password} onChange={set('password')} placeholder="8+ characters" autoComplete="new-password" />
              </div>
              <div className="field">
                <label htmlFor="confirm">Confirm Password</label>
                <input id="confirm" type="password" value={form.confirm} onChange={set('confirm')} placeholder="Repeat it" autoComplete="new-password" />
              </div>
            </>
          )}
          <div className="field"><span className="hint" role="alert">{error}</span></div>
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'One moment…' : isLogin ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="auth__foot">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" onClick={() => navigate(isLogin ? '/signup' : '/login')}>
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </section>
    </main>
  )
}
