import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../firebase.js'
import { useAuth } from '../auth.jsx'
import Brand from '../components/Brand.jsx'

function PasswordEye({ visible, onClick, label }) {
  return (
    <button
      type="button"
      className="password-toggle"
      onClick={onClick}
      aria-label={label}
      tabIndex={0}
    >
      {visible ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path
            d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path
            d="M2 12s4-7 10-7c2 0 3.5.8 5 1.8M22 12s-4 7-10 7c-2 0-3.5-.8-5-1.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 4l16 16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  )
}

function getInitials(name) {
  if (!name) return '?'
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0][0].toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function getApiErrorFeedback(err) {
  const code = err?.code || ''

  if (code === 'functions/permission-denied' || code === 'functions/invalid-argument') {
    return {
      status: 'invalid',
      message: err.message || 'This Gemini API key is invalid or unavailable.',
    }
  }

  if (code === 'functions/resource-exhausted') {
    return {
      status: 'quota',
      message: err.message || 'This key cannot be used right now. Check its Gemini quota or billing.',
    }
  }

  if (code === 'functions/unauthenticated') {
    return {
      status: 'invalid',
      message: 'Please sign in again before managing your API key.',
    }
  }

  return {
    status: 'network',
    message: err?.message || 'The secure API-key service could not be reached. Please try again.',
  }
}

export default function ProfilePage() {
  const { user, signOut } = useAuth()

  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiStatus, setApiStatus] = useState('idle')
  const [apiMessage, setApiMessage] = useState('')
  const [savedKeyEnding, setSavedKeyEnding] = useState('')
  const [apiLoading, setApiLoading] = useState(true)
  const [isReplacingApiKey, setIsReplacingApiKey] = useState(false)

  useEffect(() => {
    setError('')
    setSuccess('')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowCurrent(false)
    setShowNew(false)
    setShowConfirm(false)
  }, [showModal])

  useEffect(() => {
    let cancelled = false

    const loadApiKeyStatus = async () => {
      if (!user?.uid) {
        setApiLoading(false)
        return
      }

      setApiLoading(true)
      try {
        const manageGeminiKey = httpsCallable(functions, 'validateGeminiKey')
        const result = await manageGeminiKey({ action: 'status' })
        if (cancelled) return

        setSavedKeyEnding(result.data?.connected ? result.data.keyEnding || '' : '')
      } catch (err) {
        if (cancelled) return
        const feedback = getApiErrorFeedback(err)
        setApiStatus(feedback.status)
        setApiMessage(feedback.message)
      } finally {
        if (!cancelled) setApiLoading(false)
      }
    }

    loadApiKeyStatus()
    return () => {
      cancelled = true
    }
  }, [user?.uid])

  if (!user) return null

  const initials = getInitials(user.name)

  const openModal = () => {
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setError('')
    setSuccess('')
  }

  const handleApiKeyChange = e => {
    setApiKey(e.target.value)
    if (apiStatus !== 'validating') {
      setApiStatus('idle')
      setApiMessage('')
    }
  }

  const handleValidateApiKey = async () => {
    const key = apiKey.trim()

    if (!key) {
      setApiStatus('invalid')
      setApiMessage('Enter your Gemini API key before validating it.')
      return
    }

    setApiStatus('validating')
    setApiMessage('Securely checking this key with Gemini…')

    try {
      const validateGeminiKey = httpsCallable(functions, 'validateGeminiKey')
      const result = await validateGeminiKey({ action: 'validate', apiKey: key })

      if (!result.data?.valid) {
        throw new Error('Gemini did not confirm this key.')
      }

      setApiStatus('valid')
      setApiMessage('Gemini confirmed that this API key is valid.')
    } catch (err) {
      const feedback = getApiErrorFeedback(err)
      setApiStatus(feedback.status)
      setApiMessage(feedback.message)
    }
  }

  const handleSaveApiKey = async () => {
    if (apiStatus !== 'valid') return

    setApiStatus('saving')
    setApiMessage('Encrypting and securely saving your key…')

    try {
      const manageGeminiKey = httpsCallable(functions, 'validateGeminiKey')
      const result = await manageGeminiKey({ action: 'save', apiKey: apiKey.trim() })

      setSavedKeyEnding(result.data?.keyEnding || apiKey.trim().slice(-4))
      setApiKey('')
      setShowApiKey(false)
      setIsReplacingApiKey(false)
      setApiStatus('saved')
      setApiMessage('Your Gemini API key was encrypted and saved securely.')
    } catch (err) {
      const feedback = getApiErrorFeedback(err)
      setApiStatus(feedback.status)
      setApiMessage(feedback.message)
    }
  }

  const handleReplaceApiKey = () => {
    setIsReplacingApiKey(true)
    setApiStatus('idle')
    setApiMessage('')
  }

  const handleCancelReplaceApiKey = () => {
    setApiKey('')
    setShowApiKey(false)
    setIsReplacingApiKey(false)
    setApiStatus('idle')
    setApiMessage('')
  }

  const handleRemoveApiKey = async () => {
    const confirmed = window.confirm(
      'Remove your saved Gemini API key? AI screening will be unavailable until you add another key.',
    )
    if (!confirmed) return

    setApiStatus('removing')
    setApiMessage('Removing your saved key…')

    try {
      const manageGeminiKey = httpsCallable(functions, 'validateGeminiKey')
      await manageGeminiKey({ action: 'remove' })
      setApiKey('')
      setSavedKeyEnding('')
      setShowApiKey(false)
      setIsReplacingApiKey(false)
      setApiStatus('idle')
      setApiMessage('')
    } catch (err) {
      const feedback = getApiErrorFeedback(err)
      setApiStatus(feedback.status)
      setApiMessage(feedback.message)
    }
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      return setError('Please fill in all fields.')
    }

    if (newPassword.length < 6) {
      return setError('New password must be at least 6 characters.')
    }

    if (newPassword !== confirmPassword) {
      return setError('Passwords do not match.')
    }

    setBusy(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user.raw, credential)
      await updatePassword(user.raw, newPassword)
      setSuccess('Password changed successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => {
        closeModal()
      }, 1500)
    } catch (err) {
      const code = err.code || ''
      switch (code) {
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
          setError('Incorrect current password. Please try again.')
          break
        case 'auth/weak-password':
          setError('New password is too weak. Use at least 6 characters.')
          break
        case 'auth/network-request-failed':
          setError('Network error. Please check your connection and try again.')
          break
        case 'auth/too-many-requests':
          setError('Too many attempts. Please try again later.')
          break
        case 'auth/requires-recent-login':
          setError('Please confirm your current password to continue.')
          break
        default:
          setError('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <header className="topbar glass glass--strong">
        <Brand />
        <nav>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/candidates">Candidates</NavLink>
          <NavLink to="/screening">Screening</NavLink>
          <NavLink to="/interviews">Interviews</NavLink>
          <NavLink to="/reports">Reports</NavLink>
        </nav>
        <span className="spacer" />
        <NavLink to="/profile" className="avatar" title={user.email}>{initials}</NavLink>
        <button className="btn btn--ghost" onClick={signOut}>Log out</button>
      </header>

      <main className="profile">
      <div className="profile__outer glass glass--strong">
        {/* Left: Profile Card */}
        <div className="profile__left">
          <div className="profile__card glass">
            <div className="profile__avatar">{initials}</div>
            <h2 className="profile__name">{user.name}</h2>
            <p className="profile__email">{user.email}</p>
          </div>
        </div>

        {/* Right: Account Details */}
        <div className="profile__right">
          {/* Personal Information */}
          <section className="profile__section">
            <h3>Personal Information</h3>
            <div className="profile__field">
              <label>Full Name</label>
              <div className="profile__value">{user.name}</div>
            </div>
            <div className="profile__field">
              <label>Email Address</label>
              <div className="profile__value">{user.email}</div>
            </div>
          </section>

          {/* Password */}
          <section className="profile__section">
            <h3>Password</h3>
            <div className="profile__password-row">
              <div className="profile__field" style={{ flex: 1 }}>
                <label>Password</label>
                <div className="profile__value profile__value--masked">••••••••••••</div>
              </div>
              <button className="btn btn--primary" onClick={openModal}>
                Change Password
              </button>
            </div>
          </section>

          {/* Success message */}
          {success && (
            <div className="profile__alert profile__alert--success" role="status">
              {success}
            </div>
          )}
        </div>
      </div>

      {/* Gemini API setup */}
      <section className="profile__api-card profile__section glass glass--strong">
        <h3>AI Provider Settings</h3>
        <div className="profile__api-guide">
          <div className="profile__api-guide-heading">
            <span className="profile__api-badge" aria-hidden="true">✦</span>
            <div>
              <h4>Connect Gemini API</h4>
              <p>Connect your own Gemini API key to use AI-powered resume screening.</p>
            </div>
          </div>

          <ol className="profile__api-steps">
            <li>
              Open{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Google AI Studio
              </a>{' '}
              and sign in.
            </li>
            <li>Select <strong>Create API key</strong>.</li>
            <li>Choose or create a Google Cloud project.</li>
            <li>Copy the generated API key.</li>
            <li>Return here and paste the key in the field provided.</li>
          </ol>

          <p className="profile__api-note">
            Keep your key private. Gemini usage is subject to Google's quotas and billing,
            and the complete key will not be displayed after it is saved.
          </p>
        </div>

        <div className="profile__api-form">
          <div className="profile__api-form-head">
            <div>
              <span>Provider</span>
              <strong>Google Gemini</strong>
            </div>
            <span className={`profile__api-connection ${savedKeyEnding ? 'profile__api-connection--ready' : ''}`}>
              <i aria-hidden="true" />
              {apiLoading ? 'Checking…' : savedKeyEnding ? 'Key added' : 'Not connected'}
            </span>
          </div>

          {savedKeyEnding && !isReplacingApiKey ? (
            <div className="profile__api-saved">
              <div>
                <span>Saved API key</span>
                <strong>••••••••••••{savedKeyEnding}</strong>
              </div>
              <div className="profile__api-saved-actions">
                <button type="button" className="btn" onClick={handleReplaceApiKey}>
                  Replace Key
                </button>
                <button type="button" className="btn profile__api-remove" onClick={handleRemoveApiKey}>
                  Remove Key
                </button>
              </div>
            </div>
          ) : (
            <div className="profile__api-entry">
              <div className="field">
                <label htmlFor="gemini-api-key">Gemini API key</label>
                <div className="field__input-wrap">
                  <input
                    id="gemini-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    placeholder="Paste your Gemini API key"
                    autoComplete="off"
                    spellCheck="false"
                    disabled={apiStatus === 'validating' || apiStatus === 'saving' || apiLoading}
                    aria-describedby="gemini-api-status"
                  />
                  <PasswordEye
                    visible={showApiKey}
                    onClick={() => setShowApiKey(value => !value)}
                    label={showApiKey ? 'Hide API key' : 'Show API key'}
                  />
                </div>
              </div>

              <div className="profile__api-actions">
                {isReplacingApiKey && (
                  <button type="button" className="btn" onClick={handleCancelReplaceApiKey}>
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={handleValidateApiKey}
                  disabled={apiStatus === 'validating' || apiStatus === 'saving' || apiLoading}
                >
                  {apiStatus === 'validating' ? 'Validating…' : 'Validate Key'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleSaveApiKey}
                  disabled={apiStatus !== 'valid' || apiLoading}
                >
                  {apiStatus === 'saving' ? 'Saving…' : 'Save Key'}
                </button>
              </div>
            </div>
          )}

          {apiMessage && (
            <div
              id="gemini-api-status"
              className={`profile__api-status profile__api-status--${apiStatus}`}
              role="status"
            >
              <span aria-hidden="true">
                {apiStatus === 'validating' || apiStatus === 'saving' || apiStatus === 'removing'
                  ? '◌'
                  : apiStatus === 'invalid' || apiStatus === 'quota' || apiStatus === 'network'
                    ? '!'
                    : '✓'}
              </span>
              {apiMessage}
            </div>
          )}

          <p className="profile__api-preview-note">
            Your complete key is encrypted by the backend and is never displayed again after saving.
          </p>
        </div>
      </section>

      {/* Change Password Modal */}
      {showModal && (
        <div className="modal" onClick={closeModal}>
          <div
            className="modal__card glass glass--strong"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-password-title"
          >
            <h3 id="change-password-title">Change Password</h3>
            <form className="auth__form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="current-password">Current Password</label>
                <div className="field__input-wrap">
                  <input
                    id="current-password"
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <PasswordEye
                    visible={showCurrent}
                    onClick={() => setShowCurrent(v => !v)}
                    label={showCurrent ? 'Hide current password' : 'Show current password'}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="new-password">New Password</label>
                <div className="field__input-wrap">
                  <input
                    id="new-password"
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <PasswordEye
                    visible={showNew}
                    onClick={() => setShowNew(v => !v)}
                    label={showNew ? 'Hide new password' : 'Show new password'}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="confirm-password">Confirm New Password</label>
                <div className="field__input-wrap">
                  <input
                    id="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <PasswordEye
                    visible={showConfirm}
                    onClick={() => setShowConfirm(v => !v)}
                    label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                  />
                </div>
              </div>
              <div className="field">
                <span className="hint" role="alert">{error}</span>
              </div>
              <div className="modal__actions">
                <button
                  type="button"
                  className="btn"
                  onClick={closeModal}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={busy}
                >
                  {busy ? 'One moment…' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </main>
    </div>
  )
}
