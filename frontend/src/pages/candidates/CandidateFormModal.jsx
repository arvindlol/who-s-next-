import { useMemo, useRef, useState } from 'react'
import { Modal, ModalHead } from './parts.jsx'
import { getEmailSuggestions } from '../../utils/email.js'
import { validateResumeFile } from '../../utils/candidateModel.js'

const EMPTY_FORM = { name: '', role: '', email: '', phone: '', skills: '', notes: '' }

/**
 * Add / edit candidate form.
 * - validate(values, file) → { error } | { values }   (duplicate checks live in the page)
 * - onSubmit(values, file, keepOpen) → Promise<boolean> (true when saved)
 */
export default function CandidateFormModal({
  editing = null,
  jobTitles,
  saving,
  validate,
  onSubmit,
  onClose,
}) {
  const [form, setForm] = useState(() => (editing
    ? {
      name: editing.name,
      role: editing.role,
      email: editing.email,
      phone: editing.phone,
      skills: editing.skills.join(', '),
      notes: editing.notes,
    }
    : EMPTY_FORM))
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [emailFocused, setEmailFocused] = useState(false)
  const [error, setError] = useState('')
  const nameInputRef = useRef(null)
  const fileInputRef = useRef(null)

  const isEditing = Boolean(editing)
  const hasCurrentResume = Boolean(editing?.resumePath || editing?.resumeUrl)
  const emailSuggestions = useMemo(() => (emailFocused ? getEmailSuggestions(form.email) : []), [emailFocused, form.email])

  const update = event => {
    const { name, value } = event.target
    setForm(previous => ({ ...previous, [name]: value }))
  }

  const acceptFile = nextFile => {
    const fileError = validateResumeFile(nextFile)
    if (fileError) {
      setError(fileError)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setError('')
    setFile(nextFile || null)
  }

  const submit = async (event, keepOpen = false) => {
    event.preventDefault()
    if (saving) return

    const result = validate(form, file)
    if (result.error) {
      setError(result.error)
      return
    }

    setError('')
    const saved = await onSubmit(result.values, file, keepOpen)
    if (saved && keepOpen) {
      setForm(EMPTY_FORM)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      nameInputRef.current?.focus()
    }
  }

  return (
    <Modal onClose={() => !saving && onClose()} labelledBy="candidate-form-title">
      <ModalHead
        id="candidate-form-title"
        title={isEditing ? 'Edit candidate' : 'Add a candidate'}
        text={isEditing
          ? 'Update their details or replace the resume. Their hiring stage stays the same.'
          : 'Start with a name, role and email. Add a PDF resume to screen them.'}
        onClose={onClose}
        disabled={saving}
        closeLabel="Close candidate form"
      />

      <form onSubmit={submit} noValidate>
        <div className="cand-form-grid">
          <div className="field">
            <label htmlFor="candidate-name">Full name *</label>
            <input
              ref={nameInputRef}
              id="candidate-name"
              name="name"
              value={form.name}
              onChange={update}
              placeholder="e.g. Rahul Kumar"
              maxLength={100}
              autoComplete="off"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="candidate-role">Applying for *</label>
            <input
              id="candidate-role"
              name="role"
              value={form.role}
              onChange={update}
              placeholder="e.g. Frontend Developer"
              maxLength={150}
              autoComplete="off"
              list="candidate-role-options"
              required
            />
            <datalist id="candidate-role-options">
              {jobTitles.map(title => <option key={title} value={title} />)}
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="candidate-email">Email address *</label>
            <input
              id="candidate-email"
              type="email"
              inputMode="email"
              name="email"
              value={form.email}
              onChange={update}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              placeholder="e.g. rahul.kumar@company.com"
              maxLength={254}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            {emailSuggestions.length > 0 && (
              <div className="email-suggest" role="listbox" aria-label="Email suggestions">
                {emailSuggestions.map(suggestion => (
                  <button
                    key={suggestion.value}
                    type="button"
                    role="option"
                    aria-selected="false"
                    // Keep the input focused so the tap doesn't trigger blur first.
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => setForm(previous => ({ ...previous, email: suggestion.value }))}
                  >
                    {suggestion.local}<strong>@{suggestion.domain}</strong>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="candidate-phone">Phone (optional)</label>
            <input
              id="candidate-phone"
              type="tel"
              inputMode="tel"
              name="phone"
              value={form.phone}
              onChange={update}
              placeholder="e.g. +91 98765 43210"
              maxLength={20}
              autoComplete="off"
            />
          </div>

          <div className="field cand-form-grid__full">
            <label htmlFor="candidate-skills">Key skills (optional)</label>
            <input
              id="candidate-skills"
              name="skills"
              value={form.skills}
              onChange={update}
              placeholder="e.g. React, TypeScript, REST APIs"
              maxLength={1000}
              autoComplete="off"
            />
            <small className="hint">Separate skills with commas. They help suggest interview topics.</small>
          </div>

          <div className="field cand-form-grid__full">
            <label htmlFor="candidate-resume">Resume (PDF{isEditing ? '' : ', optional'})</label>
            <div
              className={`resume-upload-box ${dragging ? 'resume-upload-box--drag' : ''} ${file ? 'resume-upload-box--filled' : ''}`}
              onDragOver={event => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => {
                event.preventDefault()
                setDragging(false)
                acceptFile(event.dataTransfer.files?.[0] || null)
              }}
            >
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                {file || hasCurrentResume ? 'Change resume' : 'Choose resume'}
              </button>
              <span>
                {file
                  ? file.name
                  : hasCurrentResume
                    ? `Current: ${editing.resumeName || 'Resume on file'} · choose a PDF to replace it`
                    : 'Drag and drop here · PDF only · up to 10 MB'}
              </span>
            </div>
            <input
              ref={fileInputRef}
              id="candidate-resume"
              type="file"
              className="visually-hidden"
              accept=".pdf,application/pdf"
              onChange={event => acceptFile(event.target.files?.[0] || null)}
            />
          </div>

          <div className="field cand-form-grid__full">
            <label htmlFor="candidate-notes">Notes (optional)</label>
            <textarea
              id="candidate-notes"
              name="notes"
              value={form.notes}
              onChange={update}
              placeholder="Referral source, salary expectations, anything worth remembering…"
              rows="3"
              maxLength={3000}
            />
          </div>
        </div>

        {error && <div role="alert" className="candidate-form-error">{error}</div>}

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          {!isEditing && (
            <button type="button" className="btn" onClick={event => submit(event, true)} disabled={saving}>
              Save &amp; add another
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save candidate'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
