import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import { getAuthErrorMessage, MIN_PASSWORD_LENGTH, useAuth } from '../auth.jsx'
import { EMAIL_PATTERN } from '../utils/email.js'

const STAGES = ['Check Resume Fit', 'Plan the Interview', 'Conduct Interview', 'Upload Transcript', 'Get Brief Report']

export default function Auth({ mode }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const { signIn, signUp, resetPassword } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setError('')
    setInfo('')
  }, [mode])

  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }))

  const submit = async event => {
    event.preventDefault()
    if (busy) return
    setError('')
    setInfo('')

    const email = form.email.trim()
    const name = form.name.trim()

    if (!email) return setError('Please enter your work email.')
    if (!EMAIL_PATTERN.test(email)) return setError('Please enter a valid email address.')
    if (!form.password) return setError('Please enter your password.')

    if (!isLogin) {
      if (!name) return setError('Please enter your full name.')
      if (form.password.length < MIN_PASSWORD_LENGTH) return setError(`Password needs at least ${MIN_PASSWORD_LENGTH} characters.`)
      if (form.password !== form.confirm) return setError('Passwords do not match.')
    }

    setBusy(true)
    try {
      if (isLogin) await signIn({ email, password: form.password })
      else await signUp({ email, password: form.password, name })
      navigate('/', { replace: true })
    } catch (err) {
      setError(getAuthErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const forgotPassword = async () => {
    const email = form.email.trim()
    setError('')
    setInfo('')
    if (!EMAIL_PATTERN.test(email)) return setError('Enter your email address above, then choose “Forgot password?” again.')
    try {
      await resetPassword(email)
    } catch (err) {
      // Do not reveal whether an account exists; only report real problems such as network errors.
      if (err?.code !== 'auth/user-not-found') return setError(getAuthErrorMessage(err))
    }
    setInfo('If an account exists for that email, a password reset link is on its way.')
  }

  return (
    <main className="auth">
      <section className="auth__story">
        <Brand />
        <h1>You lead the interview. We help you prepare.</h1>
        <p>Who’s Next analyses the role and candidate to help you ask better questions and turn interviews into meaningful insights.</p>
        <p className="auth__tagline">Prepare better. Ask smarter. Hire with clarity.</p>
        <div className="flow" aria-label="How Who's Next works">
          {STAGES.map((label, index) => (
            <span key={label} style={{ display: 'contents' }}>
              {index > 0 && <span className="arrow" aria-hidden="true">›</span>}
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
              <input id="name" value={form.name} onChange={set('name')} placeholder="Priya Sharma" autoComplete="name" maxLength={100} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" autoComplete="email" />
          </div>
          <PasswordInput
            id="password"
            label="Password"
            value={form.password}
            onChange={set('password')}
            placeholder={isLogin ? '••••••••' : `${MIN_PASSWORD_LENGTH}+ characters`}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
          {!isLogin && (
            <PasswordInput
              id="confirm"
              label="Confirm password"
              revealLabel="confirm password"
              value={form.confirm}
              onChange={set('confirm')}
              placeholder="Repeat it"
              autoComplete="new-password"
            />
          )}
          {isLogin && (
            <button type="button" className="auth__link" onClick={forgotPassword}>Forgot password?</button>
          )}
          <div className="field">
            <span className="hint" role="alert">{error}</span>
            {info && <span className="hint hint--ok" role="status">{info}</span>}
          </div>
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'One moment…' : isLogin ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="auth__foot">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" onClick={() => navigate(isLogin ? '/signup' : '/login')}>{isLogin ? 'Sign up' : 'Log in'}</button>
        </p>
      </section>
    </main>
  )
}
