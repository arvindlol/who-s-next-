{/*import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'

const STAGES = [
  ['Job description', false], ['Resume fit', false], ['Interview plan', false],
  ['Interview', true], ['Transcript', false], ['Final report', false],
]

export default function Auth({ mode }) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const { signIn, signUp } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async e => {
    e.preventDefault()
    setError('')
    if (!form.email.includes('@')) return setError('Enter a valid email address.')
    if (form.password.length < 8) return setError('Password needs at least 8 characters.')
    if (!isLogin && form.password !== form.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      isLogin ? await signIn(form) : await signUp(form)
      navigate('/')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <section className="auth__story">
        <Brand />
        <h1>Interview with a plan, not a guess.</h1>
        <p>
          Sift reads the job description and each resume, writes a candidate-specific
          interview plan, and turns the transcript into a structured evaluation. You still
          run the interview and make the call.
        </p>
        <div className="flow" aria-label="How Sift works">
          {STAGES.map(([label, human], i) => (
            <span key={label} style={{ display: 'contents' }}>
              {i > 0 && <span className="arrow" aria-hidden="true">›</span>}
              <span className={`node${human ? ' node--human' : ''}`}>{label}{human ? ' (you)' : ''}</span>
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
            <div className="auth__row">
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" value={form.password} onChange={set('password')} placeholder="8+ characters" autoComplete="new-password" />
              </div>
              <div className="field">
                <label htmlFor="confirm">Confirm</label>
                <input id="confirm" type="password" value={form.confirm} onChange={set('confirm')} placeholder="Repeat it" autoComplete="new-password" />
              </div>
            </div>
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
*/}




import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Auth({ mode = "login" }) {
  const navigate = useNavigate();

  const { signIn, signUp } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isSignup = mode === "signup";

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");

    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }

    if (isSignup && !name) {
      setError("Please enter your name.");
      return;
    }

    try {
      setLoading(true);

      if (isSignup) {
        await signUp({
          email,
          password,
          name,
        });
      } else {
        await signIn({
          email,
          password,
        });
      }

      // Login/signup successful
      navigate("/homepage", { replace: true });
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>{isSignup ? "Sign Up" : "Login"}</h1>

        <form onSubmit={handleSubmit}>
          {isSignup && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p>{error}</p>}

          <button type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : isSignup
              ? "Sign Up"
              : "Login"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            if (isSignup) {
              navigate("/login");
            } else {
              navigate("/signup");
            }
          }}
        >
          {isSignup
            ? "Already have an account? Login"
            : "Don't have an account? Sign Up"}
        </button>
      </div>
    </div>
  );
}