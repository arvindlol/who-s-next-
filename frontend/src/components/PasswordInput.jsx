import { useState } from 'react'

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M2 12s4-7 10-7c2 0 3.5.8 5 1.8M22 12s-4 7-10 7c-2 0-3.5-.8-5-1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Password (or other secret) input with a show/hide toggle. Extra props go to the <input>. */
export default function PasswordInput({ id, label, revealLabel = 'password', ...inputProps }) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      <div className="field__input-wrap">
        <input id={id} type={visible ? 'text' : 'password'} {...inputProps} />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible(value => !value)}
          aria-label={visible ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
        >
          <EyeIcon visible={visible} />
        </button>
      </div>
    </div>
  )
}
