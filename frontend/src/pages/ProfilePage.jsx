import { useEffect, useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import AppLayout from '../components/AppLayout.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import { MIN_PASSWORD_LENGTH, useAuth } from '../auth.jsx'
import { api } from '../services/api.js'
import { callableErrorMessage } from '../services/errorMessages.js'
import { getInitials } from '../utils/format.js'

function keyErrorFeedback(error) {
  const code = String(error?.code || '').replace(/^functions\//, '')
  const status = code === 'resource-exhausted' ? 'quota'
    : ['permission-denied', 'invalid-argument', 'unauthenticated', 'failed-precondition'].includes(code) ? 'invalid'
      : 'network'
  return { status, message: callableErrorMessage(error, 'The secure API-key service could not be reached. Please try again.') }
}

function passwordErrorMessage(code) {
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
      return 'Incorrect current password. Please try again.'
    case 'auth/weak-password':
      return `New password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters.`
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection and try again.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

function ChangePasswordModal({ user, onClose, onSuccess }) {
  const [fields, setFields] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = key => event => setFields(current => ({ ...current, [key]: event.target.value }))

  const submit = async event => {
    event.preventDefault()
    setError('')
    if (!fields.current || !fields.next || !fields.confirm) return setError('Please fill in all fields.')
    if (fields.next.length < MIN_PASSWORD_LENGTH) return setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    if (fields.next !== fields.confirm) return setError('Passwords do not match.')

    setBusy(true)
    try {
      await reauthenticateWithCredential(user.raw, EmailAuthProvider.credential(user.email, fields.current))
      await updatePassword(user.raw, fields.next)
      onSuccess('Password changed successfully.')
    } catch (err) {
      setError(passwordErrorMessage(err?.code))
      setBusy(false)
    }
  }

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
      <div className="modal__card glass glass--strong" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <h3 id="change-password-title">Change password</h3>
        <form className="auth__form" onSubmit={submit} noValidate>
          <PasswordInput id="current-password" label="Current password" revealLabel="current password" value={fields.current} onChange={set('current')} autoComplete="current-password" />
          <PasswordInput id="new-password" label="New password" revealLabel="new password" value={fields.next} onChange={set('next')} placeholder={`${MIN_PASSWORD_LENGTH}+ characters`} autoComplete="new-password" />
          <PasswordInput id="confirm-password" label="Confirm new password" revealLabel="confirmation" value={fields.confirm} onChange={set('confirm')} autoComplete="new-password" />
          <div className="field"><span className="hint" role="alert">{error}</span></div>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'One moment…' : 'Change password'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteAccountModal({ onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.deleteAccount({ confirm: confirmText })
      onDeleted()
    } catch (err) {
      setError(callableErrorMessage(err, 'Your account could not be deleted. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <div className="modal" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
      <div className="modal__card glass glass--strong" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title">
        <h3 id="delete-account-title">Delete your account</h3>
        <p>This permanently deletes your account and everything in it: jobs, candidates, resumes, screenings, interview plans, transcripts, reports and your saved Gemini key. This cannot be undone.</p>
        <form className="auth__form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="delete-confirm">Type DELETE to confirm</label>
            <input id="delete-confirm" value={confirmText} onChange={event => setConfirmText(event.target.value)} autoComplete="off" />
          </div>
          <div className="field"><span className="hint" role="alert">{error}</span></div>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--danger" disabled={busy || confirmText !== 'DELETE'}>{busy ? 'Deleting everything…' : 'Delete my account'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const { user, signOut } = useAuth()
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState('')

  const [apiKey, setApiKey] = useState('')
  const [apiStatus, setApiStatus] = useState('idle')
  const [apiMessage, setApiMessage] = useState('')
  const [savedKeyEnding, setSavedKeyEnding] = useState('')
  const [apiLoading, setApiLoading] = useState(true)
  const [replacing, setReplacing] = useState(false)

  useEffect(() => {
    if (!user?.uid) return undefined
    let cancelled = false
    setApiLoading(true)
    api.geminiKey({ action: 'status' })
      .then(result => !cancelled && setSavedKeyEnding(result?.connected ? result.keyEnding || '' : ''))
      .catch(error => {
        if (cancelled) return
        const feedback = keyErrorFeedback(error)
        setApiStatus(feedback.status)
        setApiMessage(feedback.message)
      })
      .finally(() => !cancelled && setApiLoading(false))
    return () => { cancelled = true }
  }, [user?.uid])

  if (!user) return null

  const working = ['validating', 'saving', 'removing'].includes(apiStatus)

  const runKeyAction = async (status, message, action, onDone) => {
    setApiStatus(status)
    setApiMessage(message)
    try {
      const result = await api.geminiKey(action)
      onDone(result)
    } catch (error) {
      const feedback = keyErrorFeedback(error)
      setApiStatus(feedback.status)
      setApiMessage(feedback.message)
    }
  }

  const validateKey = () => {
    const key = apiKey.trim()
    if (!key) {
      setApiStatus('invalid')
      setApiMessage('Enter your Gemini API key before validating it.')
      return
    }
    runKeyAction('validating', 'Securely checking this key with Gemini…', { action: 'validate', apiKey: key }, () => {
      setApiStatus('valid')
      setApiMessage('Gemini confirmed that this API key works.')
    })
  }

  const saveKey = () => runKeyAction('saving', 'Encrypting and saving your key…', { action: 'save', apiKey: apiKey.trim() }, result => {
    setSavedKeyEnding(result?.keyEnding || apiKey.trim().slice(-4))
    setApiKey('')
    setReplacing(false)
    setApiStatus('saved')
    setApiMessage('Your Gemini API key was encrypted and saved.')
  })

  const removeKey = () => {
    if (!window.confirm('Remove your saved Gemini API key? AI screening, planning and reports will be unavailable until you add another key.')) return
    runKeyAction('removing', 'Removing your saved key…', { action: 'remove' }, () => {
      setSavedKeyEnding('')
      setApiKey('')
      setReplacing(false)
      setApiStatus('idle')
      setApiMessage('')
    })
  }

  return (
    <AppLayout mainClassName="profile">
      <div className="profile__outer glass glass--strong">
        <div className="profile__left">
          <div className="profile__card glass">
            <div className="profile__avatar">{getInitials(user.name)}</div>
            <h2 className="profile__name">{user.name}</h2>
            <p className="profile__email">{user.email}</p>
          </div>
        </div>

        <div className="profile__right">
          <section className="profile__section">
            <h3>Personal information</h3>
            <div className="profile__field"><label>Full name</label><div className="profile__value">{user.name}</div></div>
            <div className="profile__field"><label>Email address</label><div className="profile__value">{user.email}</div></div>
          </section>

          <section className="profile__section">
            <h3>Password</h3>
            <div className="profile__password-row">
              <div className="profile__field" style={{ flex: 1 }}>
                <label>Password</label>
                <div className="profile__value profile__value--masked">••••••••••••</div>
              </div>
              <button className="btn btn--primary" onClick={() => { setNotice(''); setModal('password') }}>Change password</button>
            </div>
          </section>

          {notice && <div className="profile__alert profile__alert--success" role="status">{notice}</div>}
        </div>
      </div>

      <section className="profile__api-card profile__section glass glass--strong">
        <h3>AI provider settings</h3>
        <div className="profile__api-guide">
          <div className="profile__api-guide-heading">
            <span className="profile__api-badge" aria-hidden="true">✦</span>
            <div>
              <h4>Connect Gemini API</h4>
              <p>Who’s Next uses your own Gemini API key for screening, interview plans and final reports.</p>
            </div>
          </div>
          <ol className="profile__api-steps">
            <li>Open <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> and sign in.</li>
            <li>Select <strong>Create API key</strong> and choose a Google Cloud project.</li>
            <li>Copy the key and paste it below.</li>
          </ol>
          <p className="profile__api-note">
            <strong>Candidate data:</strong> resumes, job descriptions and transcripts are sent to Gemini with this key. On Gemini’s free tier Google may use submitted content to improve its products, so use a key from a project with billing enabled for real candidate data.
          </p>
        </div>

        <div className="profile__api-form">
          <div className="profile__api-form-head">
            <div><span>Provider</span><strong>Google Gemini</strong></div>
            <span className={`profile__api-connection ${savedKeyEnding ? 'profile__api-connection--ready' : ''}`}>
              <i aria-hidden="true" />{apiLoading ? 'Checking…' : savedKeyEnding ? 'Key added' : 'Not connected'}
            </span>
          </div>

          {savedKeyEnding && !replacing ? (
            <div className="profile__api-saved">
              <div><span>Saved API key</span><strong>••••••••••••{savedKeyEnding}</strong></div>
              <div className="profile__api-saved-actions">
                <button type="button" className="btn" onClick={() => { setReplacing(true); setApiStatus('idle'); setApiMessage('') }}>Replace key</button>
                <button type="button" className="btn profile__api-remove" onClick={removeKey} disabled={working}>Remove key</button>
              </div>
            </div>
          ) : (
            <div className="profile__api-entry">
              <PasswordInput
                id="gemini-api-key"
                label="Gemini API key"
                revealLabel="API key"
                value={apiKey}
                onChange={event => {
                  setApiKey(event.target.value)
                  if (!working) {
                    setApiStatus('idle')
                    setApiMessage('')
                  }
                }}
                placeholder="Paste your Gemini API key"
                autoComplete="off"
                spellCheck="false"
                disabled={working || apiLoading}
                aria-describedby="gemini-api-status"
              />
              <div className="profile__api-actions">
                {replacing && <button type="button" className="btn" onClick={() => { setApiKey(''); setReplacing(false); setApiStatus('idle'); setApiMessage('') }}>Cancel</button>}
                <button type="button" className="btn" onClick={validateKey} disabled={working || apiLoading}>{apiStatus === 'validating' ? 'Validating…' : 'Validate key'}</button>
                <button type="button" className="btn btn--primary" onClick={saveKey} disabled={apiStatus !== 'valid' || apiLoading}>{apiStatus === 'saving' ? 'Saving…' : 'Save key'}</button>
              </div>
            </div>
          )}

          {apiMessage && (
            <div id="gemini-api-status" className={`profile__api-status profile__api-status--${apiStatus}`} role="status">
              <span aria-hidden="true">{working ? '◌' : ['invalid', 'quota', 'network'].includes(apiStatus) ? '!' : '✓'}</span>
              {apiMessage}
            </div>
          )}
          <p className="profile__api-preview-note">Your key is encrypted on the server and is never shown again after saving.</p>
        </div>
      </section>

      <section className="profile__api-card profile__section glass glass--strong profile__danger">
        <h3>Delete account</h3>
        <p>Permanently delete your account and all of your data, including candidate resumes and reports.</p>
        <button type="button" className="btn btn--danger" onClick={() => setModal('delete')}>Delete account…</button>
      </section>

      {modal === 'password' && (
        <ChangePasswordModal
          user={user}
          onClose={() => setModal('')}
          onSuccess={message => {
            setModal('')
            setNotice(message)
          }}
        />
      )}
      {modal === 'delete' && (
        <DeleteAccountModal
          onClose={() => setModal('')}
          onDeleted={() => signOut().catch(() => {})}
        />
      )}
    </AppLayout>
  )
}
