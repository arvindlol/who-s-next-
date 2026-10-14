import { NavLink } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import './Candidates.css'

import {
collection,
addDoc,
getDocs,
deleteDoc,
doc,
updateDoc,
query,
where,
} from 'firebase/firestore'

import {
ref,
uploadBytes,
getDownloadURL,
deleteObject,
} from 'firebase/storage'

import { db, storage } from '../firebase'

const STATUS_OPTIONS = [
'Screening',
'JD Matched',
'Shortlisted',
'Interview Pending',
'Selected',
'Dropped',
'Rejected',
]

const INITIAL_CANDIDATES = [
{
id: 'sample-1',
name: 'Aarav Sharma',
role: 'Senior Backend Engineer',
status: 'JD Matched',
email: 'aarav@example.com',
resume: '',
notes: '',
isSample: true,
},
{
id: 'sample-2',
name: 'Priya Mehta',
role: 'Frontend Developer',
status: 'Screening',
email: 'priya@example.com',
resume: '',
notes: '',
isSample: true,
},
{
id: 'sample-3',
name: 'Rohan Verma',
role: 'Data Engineer',
status: 'Shortlisted',
email: 'rohan@example.com',
resume: '',
notes: '',
isSample: true,
},
{
id: 'sample-4',
name: 'Ananya Singh',
role: 'Senior Backend Engineer',
status: 'Interview Pending',
email: 'ananya@example.com',
resume: '',
notes: '',
isSample: true,
},
]

function getStatusType(status) {
if (
status === 'JD Matched' ||
status === 'Selected'
) {
return 'live'
}

if (status === 'Shortlisted') {
return 'ok'
}

if (
status === 'Dropped' ||
status === 'Rejected'
) {
return 'danger'
}

return 'warn'
}

function getErrorMessage(error) {
if (error?.code === 'permission-denied') {
return 'Permission denied. Please check your Firestore security rules.'
}

if (error?.code === 'storage/unauthorized') {
return 'You do not have permission to upload or delete this resume. Please check Firebase Storage rules.'
}

if (error?.code === 'storage/canceled') {
return 'The resume upload was canceled.'
}

return error?.message || 'Something went wrong. Please try again.'
}

export default function Candidates() {
const { user, signOut } = useAuth()

const initials = (
user?.displayName ||
user?.name ||
user?.email ||
'U'
)
.slice(0, 2)
.toUpperCase()

const candidateResumeRef = useRef(null)

const [candidates, setCandidates] = useState(
INITIAL_CANDIDATES
)

const [resumeFile, setResumeFile] = useState(null)

const [showAddModal, setShowAddModal] = useState(false)
const [showViewModal, setShowViewModal] = useState(false)
const [showDeleteModal, setShowDeleteModal] = useState(false)

const [selectedCandidate, setSelectedCandidate] = useState(null)
const [candidateToDelete, setCandidateToDelete] = useState(null)

const [filter, setFilter] = useState('All')
const [search, setSearch] = useState('')

const [loading, setLoading] = useState(true)
const [saving, setSaving] = useState(false)
const [deleting, setDeleting] = useState(false)

const [notification, setNotification] = useState(null)

const [form, setForm] = useState({
name: '',
role: '',
email: '',
status: 'Screening',
resume: '',
notes: '',
})

// =========================================
// CENTERED NOTIFICATIONS
// =========================================

const notify = (message, type = 'success') => {
setNotification({
message,
type,
})
}

useEffect(() => {
if (!notification) return undefined

const timer = window.setTimeout(() => {
  setNotification(null)
}, 3000)

return () => window.clearTimeout(timer)

}, [notification])

// =========================================
// LOAD CANDIDATES
// =========================================

useEffect(() => {
let active = true

const loadCandidates = async () => {
  if (!user?.uid) {
    if (active) {
      setCandidates([])
      setLoading(false)
    }

    return
  }

  setLoading(true)

  try {
    const candidatesQuery = query(
      collection(db, 'candidates'),
      where('ownerId', '==', user.uid)
    )

    const snapshot = await getDocs(candidatesQuery)

    if (!active) return

    const firestoreCandidates = snapshot.docs.map(
      (candidateDoc) => {
        const data = candidateDoc.data()

        return {
          id: candidateDoc.id,
          name: data.name || '',
          role: data.role || '',
          status: STATUS_OPTIONS.includes(data.status)
            ? data.status
            : 'Screening',
          email: data.email || '',
          resume: data.resume || '',
          notes: data.additionalinformation || '',
          isSample: false,
        }
      }
    )

    // Sample profiles are shown only when the user's
    // Firestore candidate collection is empty.
    setCandidates(
      firestoreCandidates.length > 0
        ? firestoreCandidates
        : INITIAL_CANDIDATES
    )
  } catch (error) {
    console.error('Error loading candidates:', error)

    if (active) {
      notify(
        `Could not load candidates: ${getErrorMessage(error)}`,
        'error'
      )
    }
  } finally {
    if (active) {
      setLoading(false)
    }
  }
}

loadCandidates()

return () => {
  active = false
}

}, [user?.uid])

// =========================================
// ADD MODAL
// =========================================

const openAddModal = () => {
setForm({
name: '',
role: '',
email: '',
status: 'Screening',
resume: '',
notes: '',
})

setResumeFile(null)
setShowAddModal(true)

}

const closeAddModal = () => {
if (saving) return

setShowAddModal(false)
setResumeFile(null)

}

// =========================================
// FORM CHANGE
// =========================================

const handleFormChange = (event) => {
const { name, value } = event.target

setForm((previous) => ({
  ...previous,
  [name]: value,
}))

}

// =========================================
// RESUME SELECTION
// =========================================

const handleCandidateResume = (event) => {
const file = event.target.files?.[0]

if (!file) return

const allowedExtensions = /\.(pdf|doc|docx)$/i

if (!allowedExtensions.test(file.name)) {
  notify(
    'Please select a PDF, DOC, or DOCX resume.',
    'error'
  )

  event.target.value = ''
  return
}

// Keep uploads within a reasonable size.
if (file.size > 10 * 1024 * 1024) {
  notify('Resume size must not exceed 10 MB.', 'error')
  event.target.value = ''
  return
}

setResumeFile(file)

setForm((previous) => ({
  ...previous,
  resume: file.name,
}))

event.target.value = ''

}

// =========================================
// ADD CANDIDATE
// =========================================

const handleAddCandidate = async (event) => {
event.preventDefault()

if (saving) return

if (!user?.uid) {
  notify('Please log in before adding a candidate.', 'error')
  return
}

if (!form.name.trim()) {
  notify('Please enter the candidate name.', 'error')
  return
}

if (!form.role.trim()) {
  notify('Please enter the candidate role.', 'error')
  return
}

if (!form.email.trim()) {
  notify('Email is compulsory.', 'error')
  return
}

if (!resumeFile) {
  notify('Please upload the candidate resume.', 'error')
  return
}

setSaving(true)

let createdDocumentId = null
let uploadedResumeRef = null

try {
  const candidateData = {
    name: form.name.trim(),
    role: form.role.trim(),
    email: form.email.trim(),
    status: 'Screening',
    resume: '',
    additionalinformation: form.notes.trim(),
    ownerId: user.uid,
    createdAt: new Date().toISOString(),
  }

  // Create the candidate document first.
  const docRef = await addDoc(
    collection(db, 'candidates'),
    candidateData
  )

  createdDocumentId = docRef.id

  // Upload the resume to Firebase Storage.
  const safeFileName = resumeFile.name.replace(
    /[^a-zA-Z0-9._-]/g,
    '_'
  )

  uploadedResumeRef = ref(
    storage,
    `resumes/${user.uid}/${docRef.id}-${safeFileName}`
  )

  await uploadBytes(uploadedResumeRef, resumeFile)

  const resumeUrl = await getDownloadURL(
    uploadedResumeRef
  )

  // Save the download URL in Firestore.
  await updateDoc(
    doc(db, 'candidates', docRef.id),
    {
      resume: resumeUrl,
    }
  )

  const newCandidate = {
    id: docRef.id,
    name: candidateData.name,
    role: candidateData.role,
    email: candidateData.email,
    status: candidateData.status,
    resume: resumeUrl,
    notes: candidateData.additionalinformation,
    isSample: false,
  }

  setCandidates((previous) => [
    ...previous.filter((candidate) => !candidate.isSample),
    newCandidate,
  ])

  setShowAddModal(false)
  setResumeFile(null)

  setForm({
    name: '',
    role: '',
    email: '',
    status: 'Screening',
    resume: '',
    notes: '',
  })

  notify('Candidate added successfully.')
} catch (error) {
  console.error('Error adding candidate:', error)

  // Roll back partially created data where possible.
  if (createdDocumentId) {
    try {
      await deleteDoc(
        doc(db, 'candidates', createdDocumentId)
      )
    } catch (rollbackError) {
      console.error(
        'Could not roll back candidate document:',
        rollbackError
      )
    }
  }

  if (uploadedResumeRef) {
    try {
      await deleteObject(uploadedResumeRef)
    } catch (rollbackError) {
      console.warn(
        'Could not remove partially uploaded resume:',
        rollbackError
      )
    }
  }

  notify(
    `Failed to add candidate: ${getErrorMessage(error)}`,
    'error'
  )
} finally {
  setSaving(false)
}

}

// =========================================
// VIEW CANDIDATE
// =========================================

const handleViewCandidate = (candidate) => {
setSelectedCandidate(candidate)
setShowViewModal(true)
}

// =========================================
// UPDATE STATUS
// =========================================

const handleStatusChange = async (candidate, newStatus) => {
if (!user?.uid || !candidate || candidate.isSample) {
notify(
'Sample candidates cannot be updated. Add a candidate to manage real records.',
'error'
)
return
}

const previousStatus = candidate.status

setCandidates((previous) =>
  previous.map((item) =>
    item.id === candidate.id
      ? { ...item, status: newStatus }
      : item
  )
)

if (
  selectedCandidate?.id === candidate.id
) {
  setSelectedCandidate((previous) => ({
    ...previous,
    status: newStatus,
  }))
}

try {
  await updateDoc(
    doc(db, 'candidates', candidate.id),
    {
      status: newStatus,
    }
  )

  notify('Candidate status updated.')
} catch (error) {
  console.error('Error updating candidate status:', error)

  setCandidates((previous) =>
    previous.map((item) =>
      item.id === candidate.id
        ? { ...item, status: previousStatus }
        : item
    )
  )

  if (selectedCandidate?.id === candidate.id) {
    setSelectedCandidate((previous) => ({
      ...previous,
      status: previousStatus,
    }))
  }

  notify(
    `Could not update status: ${getErrorMessage(error)}`,
    'error'
  )
}

}

// =========================================
// DELETE CONFIRMATION
// =========================================

const askDeleteCandidate = (candidate) => {
if (candidate.isSample) {
notify(
'Sample candidates cannot be deleted. This is a demo profile.',
'error'
)
return
}

setCandidateToDelete(candidate)
setShowDeleteModal(true)

}

const closeDeleteModal = () => {
if (deleting) return

setShowDeleteModal(false)
setCandidateToDelete(null)

}

// =========================================
// DELETE CANDIDATE
// =========================================

const handleDeleteCandidate = async () => {
if (deleting || !candidateToDelete || !user?.uid) {
return
}

const candidate = candidateToDelete

setDeleting(true)

try {
  // Confirm ownership before attempting deletion.
  const candidateRef = doc(
    db,
    'candidates',
    candidate.id
  )

  // Delete the Firestore record.
  await deleteDoc(candidateRef)

  // Remove the associated Storage object if possible.
  // Storage cleanup failure should not undo the record deletion.
  if (candidate.resume) {
    try {
      const resumeRef = ref(storage, candidate.resume)
      await deleteObject(resumeRef)
    } catch (storageError) {
      console.warn(
        'Resume cleanup failed:',
        storageError
      )
    }
  }

  setCandidates((previous) =>
    previous.filter((item) => item.id !== candidate.id)
  )

  if (selectedCandidate?.id === candidate.id) {
    setSelectedCandidate(null)
    setShowViewModal(false)
  }

  setShowDeleteModal(false)
  setCandidateToDelete(null)

  notify('Candidate deleted successfully.')
} catch (error) {
  console.error('Error deleting candidate:', error)

  notify(
    `Failed to delete candidate: ${getErrorMessage(error)}`,
    'error'
  )
} finally {
  setDeleting(false)
}

}

// =========================================
// SEARCH + FILTER
// =========================================

const filteredCandidates = candidates.filter(
(candidate) => {
const searchText = search.toLowerCase().trim()

  const matchesSearch =
    !searchText ||
    candidate.name.toLowerCase().includes(searchText) ||
    candidate.role.toLowerCase().includes(searchText) ||
    candidate.email.toLowerCase().includes(searchText)

  const matchesFilter =
    filter === 'All' ||
    candidate.status === filter

  return matchesSearch && matchesFilter
}

)

// =========================================
// STATISTICS
// =========================================

const totalCandidates = candidates.length

const jdMatched = candidates.filter(
(candidate) => candidate.status === 'JD Matched'
).length

const shortlisted = candidates.filter(
(candidate) => candidate.status === 'Shortlisted'
).length

// =========================================
// UI
// =========================================

return (
<div className="shell">

  <header className="topbar glass glass--strong">

    <Brand />

    <nav>
      <NavLink to="/" end>
        Overview
      </NavLink>

      <NavLink to="/jobs">
        Jobs
      </NavLink>

      <NavLink to="/candidates">
        Candidates
      </NavLink>

      <NavLink to="/reports">
        Reports
      </NavLink>
    </nav>

    <span className="spacer" />

    <button
      className="btn btn--ghost"
      onClick={signOut}
    >
      Log out
    </button>

    <span className="avatar" title={user?.email}>
      {initials}
    </span>

  </header>

  <main className="page">

    <section className="hero">

      <div className="hero__text">

        <span className="pill pill--live">
          <span className="dot" />
          Candidate workspace
        </span>

        <h1 style={{ marginTop: 14 }}>
          Candidates
        </h1>

        <p>
          Review candidates, track job-description matches,
          and manage progress through the hiring process.
        </p>

        <div className="hero__actions">

          <button
            className="btn btn--primary"
            onClick={openAddModal}
          >
            Add candidate
          </button>

        </div>

      </div>

      <aside className="hero__stats glass glass--lg">

        <div className="stat">
          <b>{totalCandidates}</b>
          <span>Total candidates</span>
        </div>

        <div className="stat">
          <b>{jdMatched}</b>
          <span>JD Matched</span>
        </div>

        <div className="stat">
          <b>{shortlisted}</b>
          <span>Shortlisted</span>
        </div>

      </aside>

    </section>

    <section className="section">

      <div className="section__head">

        <h2>All candidates</h2>

        <div className="candidate-toolbar">

          <div className="candidate-search">
            <input
              type="search"
              placeholder="Search candidates..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          <div className="candidate-filter">
            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value)
              }
              aria-label="Filter candidates by status"
            >
              <option value="All">All statuses</option>

              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

        </div>

      </div>

      <div className="candidates glass glass--lg">

        <div className="candidate__header">
          <span>Candidate</span>
          <span>Role</span>
          <span>Status</span>
          <span>Action</span>
        </div>

        {loading ? (

          <div className="empty-candidates">
            Loading candidates...
          </div>

        ) : filteredCandidates.length === 0 ? (

          <div className="empty-candidates">
            No candidates found.
          </div>

        ) : (

          filteredCandidates.map((candidate) => (

            <div
              className="candidate"
              key={candidate.id}
            >

              <div>
                <h3>{candidate.name}</h3>
                <p>{candidate.email}</p>
              </div>

              <div className="candidate__role">
                {candidate.role}
              </div>

              <div className="candidate-status-control">

                <span
                  className={`pill pill--${getStatusType(candidate.status)}`}
                >
                  <span className="dot" />
                  {candidate.status}
                </span>

                {!candidate.isSample && (

                  <select
                    className="candidate-status-select"
                    value={candidate.status}
                    onChange={(event) =>
                      handleStatusChange(
                        candidate,
                        event.target.value
                      )
                    }
                    aria-label={`Update status for ${candidate.name}`}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>

                )}

              </div>

              <div className="candidate__actions">

                <button
                  className="btn btn--small"
                  onClick={() =>
                    handleViewCandidate(candidate)
                  }
                >
                  View
                </button>

                <button
                  className="candidate-delete-btn"
                  title={`Delete ${candidate.name}`}
                  aria-label={`Delete ${candidate.name}`}
                  onClick={() =>
                    askDeleteCandidate(candidate)
                  }
                >
                  🗑
                </button>

              </div>

            </div>

          ))

        )}

      </div>

    </section>

  </main>

  {/* =====================================
      CENTERED NOTIFICATION
  ===================================== */}

  {notification && (

    <div
      className="candidate-notification-overlay"
      role="presentation"
    >

      <div
        className={`candidate-notification candidate-notification--${notification.type}`}
        role="status"
        aria-live="polite"
      >

        <span className="candidate-notification__icon">
          {notification.type === 'error' ? '!' : '✓'}
        </span>

        <p>{notification.message}</p>

        <button
          type="button"
          className="candidate-notification__close"
          aria-label="Close notification"
          onClick={() => setNotification(null)}
        >
          ×
        </button>

      </div>

    </div>

  )}

  {/* =====================================
      ADD CANDIDATE MODAL
  ===================================== */}

  {showAddModal && (

    <div
      className="candidate-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeAddModal()
        }
      }}
    >

      <div
        className="candidate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-candidate-title"
      >

        <div className="candidate-modal__header">

          <div>

            <span className="pill pill--live">
              <span className="dot" />
              New candidate
            </span>

            <h2 id="add-candidate-title">
              Add candidate
            </h2>

            <p>
              Enter the candidate details below.
            </p>

          </div>

          <button
            type="button"
            className="modal-close"
            onClick={closeAddModal}
            disabled={saving}
            aria-label="Close add candidate form"
          >
            ×
          </button>

        </div>

        <form onSubmit={handleAddCandidate}>

          <div className="candidate-form-grid">

            <div className="candidate-form-field">
              <label htmlFor="candidate-name">
                Candidate name *
              </label>

              <input
                id="candidate-name"
                type="text"
                name="name"
                value={form.name}
                onChange={handleFormChange}
                placeholder="e.g. Rahul Kumar"
                required
              />
            </div>

            <div className="candidate-form-field">
              <label htmlFor="candidate-role">
                Candidate role *
              </label>

              <input
                id="candidate-role"
                type="text"
                name="role"
                value={form.role}
                onChange={handleFormChange}
                placeholder="e.g. Frontend Developer"
                required
              />
            </div>

            <div className="candidate-form-field candidate-form-field--full">
              <label htmlFor="candidate-email">
                Email *
              </label>

              <input
                id="candidate-email"
                type="email"
                name="email"
                value={form.email}
                onChange={handleFormChange}
                placeholder="candidate@email.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="candidate-form-field candidate-form-field--full">
              <label htmlFor="candidate-notes">
                Additional information
              </label>

              <textarea
                id="candidate-notes"
                name="notes"
                value={form.notes}
                onChange={handleFormChange}
                placeholder="Experience, certifications, strengths, or other notes..."
                rows="4"
              />

            </div>

            <div className="candidate-form-field candidate-form-field--full">

              <label>
                Resume *
              </label>

              <div className="resume-upload-box">

                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    candidateResumeRef.current?.click()
                  }
                >
                  Choose resume
                </button>

                <span>
                  {form.resume || 'PDF, DOC or DOCX · Max 10 MB'}
                </span>

              </div>

              <input
                ref={candidateResumeRef}
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleCandidateResume}
                className="candidate-file-input"
                aria-label="Upload candidate resume"
                required={!resumeFile}
              />

            </div>

          </div>

          <div className="candidate-modal__actions">

            <button
              type="button"
              className="btn"
              onClick={closeAddModal}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving}
            >
              {saving ? 'Adding...' : 'Add candidate'}
            </button>

          </div>

        </form>

      </div>

    </div>

  )}

  {/* =====================================
      VIEW CANDIDATE MODAL
  ===================================== */}

  {showViewModal && selectedCandidate && (

    <div
      className="candidate-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setShowViewModal(false)
        }
      }}
    >

      <div
        className="candidate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-candidate-title"
      >

        <div className="candidate-modal__header">

          <div>

            <span
              className={`pill pill--${getStatusType(selectedCandidate.status)}`}
            >
              <span className="dot" />
              {selectedCandidate.status}
            </span>

            <h2 id="view-candidate-title">
              {selectedCandidate.name}
            </h2>

            <p>Candidate profile</p>

          </div>

          <button
            type="button"
            className="modal-close"
            onClick={() => setShowViewModal(false)}
            aria-label="Close candidate details"
          >
            ×
          </button>

        </div>

        <div className="candidate-details">

          <div className="candidate-detail">
            <span>Role</span>
            <strong>{selectedCandidate.role}</strong>
          </div>

          <div className="candidate-detail">
            <span>Email</span>
            <strong>{selectedCandidate.email || 'Not provided'}</strong>
          </div>

          <div className="candidate-detail">
            <span>Status</span>

            {selectedCandidate.isSample ? (

              <strong>{selectedCandidate.status}</strong>

            ) : (

              <select
                className="candidate-status-select candidate-status-select--details"
                value={selectedCandidate.status}
                onChange={(event) =>
                  handleStatusChange(
                    selectedCandidate,
                    event.target.value
                  )
                }
                aria-label="Update candidate status"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

            )}

          </div>

          <div className="candidate-detail">
            <span>Resume</span>

            <strong>
              {selectedCandidate.resume ? (

                <a
                  href={selectedCandidate.resume}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Resume
                </a>

              ) : (
                'No resume uploaded'
              )}
            </strong>
          </div>

          <div className="candidate-detail">
            <span>Additional information</span>

            <strong className="candidate-notes">
              {selectedCandidate.notes ||
                'No additional information provided.'}
            </strong>
          </div>

        </div>

        <div className="candidate-modal__actions">

          <button
            type="button"
            className="btn btn--danger"
            onClick={() =>
              askDeleteCandidate(selectedCandidate)
            }
          >
            Delete candidate
          </button>

          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShowViewModal(false)}
          >
            Close
          </button>

        </div>

      </div>

    </div>

  )}

  {/* =====================================
      CENTERED DELETE CONFIRMATION
  ===================================== */}

  {showDeleteModal && candidateToDelete && (

    <div
      className="candidate-modal-overlay candidate-delete-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeDeleteModal()
        }
      }}
    >

      <div
        className="candidate-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-candidate-title"
        aria-describedby="delete-candidate-description"
      >

        <div className="candidate-confirm-icon">
          !
        </div>

        <h2 id="delete-candidate-title">
          Delete candidate?
        </h2>

        <p id="delete-candidate-description">
          Are you sure you want to delete{' '}
          <strong>{candidateToDelete.name}</strong>?
          This action cannot be undone.
        </p>

        <div className="candidate-confirm-actions">

          <button
            type="button"
            className="btn"
            onClick={closeDeleteModal}
            disabled={deleting}
          >
            Cancel
          </button>

          <button
            type="button"
            className="btn btn--danger candidate-confirm-delete"
            onClick={handleDeleteCandidate}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Yes, delete'}
          </button>

        </div>

      </div>

    </div>

  )}

  <footer className="footer">
    Sift assists interviewers. Hiring decisions stay with you.
  </footer>

</div>

)
}