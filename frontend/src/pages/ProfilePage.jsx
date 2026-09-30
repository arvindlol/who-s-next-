import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
} from 'firebase/auth'
import { auth } from '../firebase.js'
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
