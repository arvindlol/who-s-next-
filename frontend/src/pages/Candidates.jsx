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
  'Interview ready',
  'Resume reviewed',
  'Interview pending',
  'Shortlisted',
  'Selected',
  'Dropped',
  'Rejected',
]

const INITIAL_CANDIDATES = [
  {
    id: 1,
    name: 'Aarav Sharma',
    role: 'Senior Backend Engineer',
    skills: 'Python · FastAPI · PostgreSQL',
    status: 'Interview ready',
    statusType: 'live',
    email: 'aarav@example.com',
    resume: '',
    notes: '',
  },
  {
    id: 2,
    name: 'Priya Mehta',
    role: 'Frontend Developer',
    skills: 'React · TypeScript · JavaScript',
    status: 'Screening',
    statusType: 'warn',
    email: 'priya@example.com',
    resume: '',
    notes: '',
  },
  {
    id: 3,
    name: 'Rohan Verma',
    role: 'Data Engineer',
    skills: 'Python · Spark · Airflow',
    status: 'Resume reviewed',
    statusType: 'ok',
    email: 'rohan@example.com',
    resume: '',
    notes: '',
  },
  {
    id: 4,
    name: 'Ananya Singh',
    role: 'Senior Backend Engineer',
    skills: 'Python · Django · PostgreSQL',
    status: 'Interview pending',
    statusType: 'warn',
    email: 'ananya@example.com',
    resume: '',
    notes: '',
  },
]

function getStatusType(status) {
  if (status === 'Interview ready') return 'live'
  if (status === 'Resume reviewed') return 'ok'
  if (status === 'Selected') return 'live'
  if (status === 'Dropped') return 'danger'
  if (status === 'Rejected') return 'danger'

  return 'warn'
}

export default function Candidates() {
  const { user, signOut } = useAuth()

  const initials = (user?.name || 'U').slice(0, 2).toUpperCase()

  const fileInputRef = useRef(null)
  const candidateResumeRef = useRef(null)

  const [candidates, setCandidates] = useState(INITIAL_CANDIDATES)
  const [resumeFile, setResumeFile] = useState(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)

  const [selectedCandidate, setSelectedCandidate] = useState(null)

  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')

  const [form, setForm] = useState({
    name: '',
    role: '',
    skills: '',
    email: '',
    status: 'Screening',
    resume: '',
    notes: '',
  })

  // =========================================
  // LOAD CANDIDATES
  // =========================================

  useEffect(() => {
    const loadCandidates = async () => {
      try {
        const snapshot = await getDocs(
          collection(db, 'candidates')
        )

        const firestoreCandidates = snapshot.docs.map((candidateDoc) => {
          const data = candidateDoc.data()

          return {
            id: candidateDoc.id,
            name: data.name || '',
            role: data.role || '',
            skills: Array.isArray(data.skills)
              ? data.skills.join(' · ')
              : data.skills || '',
            status: data.status || 'Screening',
            statusType: getStatusType(
              data.status || 'Screening'
            ),
            email: data.email || '',
            resume: data.resume || '',
            notes: data.additionalinformation || '',
          }
        })

        setCandidates(firestoreCandidates)
      } catch (error) {
        console.error('Error loading candidates:', error)
      }
    }

    loadCandidates()
  }, [])

  // =========================================
  // MAIN RESUME BUTTON
  // =========================================

  const handleResumeUpload = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]

    if (file) {
      console.log('Selected resume:', file.name)
    }

    event.target.value = ''
  }

  // =========================================
  // ADD MODAL
  // =========================================

  const openAddModal = () => {
    setForm({
      name: '',
      role: '',
      skills: '',
      email: '',
      status: 'Screening',
      resume: '',
      notes: '',
    })

    setResumeFile(null)
    setShowAddModal(true)
  }

  const closeAddModal = () => {
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
  // CANDIDATE RESUME
  // =========================================

  const handleCandidateResume = (event) => {
    const file = event.target.files?.[0]

    if (file) {
      setResumeFile(file)

      setForm((previous) => ({
        ...previous,
        resume: file.name,
      }))
    }

    event.target.value = ''
  }

  // =========================================
  // ADD CANDIDATE
  // =========================================

  const handleAddCandidate = async (event) => {
    event.preventDefault()

    if (!form.name.trim()) {
      alert('Please enter candidate name.')
      return
    }

    if (!form.role.trim()) {
      alert('Please enter candidate role.')
      return
    }

    if (!form.skills.trim()) {
      alert('Please enter candidate skills.')
      return
    }

    if (!resumeFile) {
      alert('Please upload the candidate resume.')
      return
    }

    try {
      const candidateData = {
        name: form.name.trim(),
        role: form.role.trim(),
        skills: form.skills
          .split('·')
          .map((skill) => skill.trim())
          .filter(Boolean),
        status: form.status,
        email: form.email.trim(),
        resume: '',
        additionalinformation: form.notes.trim(),
        ownerId: user?.uid || '',
      }

      const docRef = await addDoc(
        collection(db, 'candidates'),
        candidateData
      )

      let resumeUrl = ''

      if (resumeFile && user?.uid) {
        const safeFileName = resumeFile.name.replace(
          /[^a-zA-Z0-9._-]/g,
          '_'
        )

        const resumeRef = ref(
          storage,
          `resumes/${user.uid}/${docRef.id}-${safeFileName}`
        )

        await uploadBytes(resumeRef, resumeFile)

        resumeUrl = await getDownloadURL(resumeRef)

        await updateDoc(
          doc(db, 'candidates', docRef.id),
          {
            resume: resumeUrl,
          }
        )
      }

      const newCandidate = {
        id: docRef.id,
        name: candidateData.name,
        role: candidateData.role,
        skills: form.skills.trim(),
        status: candidateData.status,
        statusType: getStatusType(candidateData.status),
        email: candidateData.email,
        resume: resumeUrl,
        notes: candidateData.additionalinformation,
      }

      setCandidates((previous) => [
        ...previous,
        newCandidate,
      ])

      closeAddModal()

      setForm({
        name: '',
        role: '',
        skills: '',
        email: '',
        status: 'Screening',
        resume: '',
        notes: '',
      })

      alert('Candidate added successfully.')
    } catch (error) {
      console.error('Error adding candidate:', error)

      alert(
        `Failed to add candidate: ${error.code || ''} ${
          error.message || ''
        }`
      )
    }
  }

  // =========================================
  // VIEW
  // =========================================

  const handleViewCandidate = (candidate) => {
    setSelectedCandidate(candidate)
    setShowViewModal(true)
  }

  // =========================================
  // DELETE
  // =========================================

  const handleDeleteCandidate = async (id) => {
    const candidate = candidates.find(
      (item) => item.id === id
    )

    if (!candidate) return

    const confirmed = window.confirm(
      `Are you sure you want to delete ${candidate.name}?\n\nThis action cannot be undone.`
    )

    if (!confirmed) return

    try {
      if (
        candidate.resume &&
        candidate.resume.startsWith('https://')
      ) {
        try {
          const resumeRef = ref(
            storage,
            candidate.resume
          )

          await deleteObject(resumeRef)
        } catch (storageError) {
          console.warn(
            'Resume could not be deleted from Storage:',
            storageError
          )
        }
      }

      await deleteDoc(
        doc(db, 'candidates', id)
      )

      setCandidates((previous) =>
        previous.filter(
          (item) => item.id !== id
        )
      )

      if (selectedCandidate?.id === id) {
        setSelectedCandidate(null)
        setShowViewModal(false)
      }

      alert('Candidate deleted successfully.')
    } catch (error) {
      console.error(
        'Error deleting candidate:',
        error
      )

      alert(
        `Failed to delete candidate: ${
          error.message || 'Please try again.'
        }`
      )
    }
  }

  // =========================================
  // SEARCH + FILTER
  // =========================================

  const filteredCandidates = candidates.filter(
    (candidate) => {
      const searchText = search
        .toLowerCase()
        .trim()

      const matchesSearch =
        !searchText ||
        candidate.name
          .toLowerCase()
          .includes(searchText) ||
        candidate.role
          .toLowerCase()
          .includes(searchText) ||
        candidate.email
          .toLowerCase()
          .includes(searchText) ||
        candidate.skills
          .toLowerCase()
          .includes(searchText)

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

  const interviewReady = candidates.filter(
    (candidate) =>
      candidate.status === 'Interview ready'
  ).length

  const resumeReviewed = candidates.filter(
    (candidate) =>
      candidate.status === 'Resume reviewed'
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

        <span
          className="avatar"
          title={user?.email}
        >
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
              Review candidates, check their skills and
              track where they are in the hiring process.
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
              <b>{interviewReady}</b>
              <span>Interview ready</span>
            </div>

            <div className="stat">
              <b>{resumeReviewed}</b>
              <span>Resume reviewed</span>
            </div>

          </aside>

        </section>

        <section className="section">

          <div className="section__head">

            <h2>
              All candidates
            </h2>

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
                >
                  <option value="All">
                    All
                  </option>

                  {STATUS_OPTIONS.map(
                    (status) => (
                      <option
                        key={status}
                        value={status}
                      >
                        {status}
                      </option>
                    )
                  )}
                </select>
              </div>

            </div>

          </div>

          <div className="candidates glass glass--lg">

            <div className="candidate__header">
              <span>Candidate</span>
              <span>Role</span>
              <span>Skills</span>
              <span>Status</span>
              <span>Action</span>
            </div>

            {filteredCandidates.length === 0 ? (

              <div className="empty-candidates">
                No candidates found.
              </div>

            ) : (

              filteredCandidates.map(
                (candidate) => (

                  <div
                    className="candidate"
                    key={candidate.id}
                  >

                    <div>
                      <h3>
                        {candidate.name}
                      </h3>

                      <p>
                        Candidate profile
                      </p>
                    </div>

                    <div className="candidate__role">
                      {candidate.role}
                    </div>

                    <div className="candidate__skills">
                      {candidate.skills}
                    </div>

                    <span
                      className={`pill pill--${candidate.statusType}`}
                    >
                      <span className="dot" />
                      {candidate.status}
                    </span>

                    <div className="candidate__actions">

                      <button
                        className="btn btn--small"
                        onClick={() =>
                          handleViewCandidate(
                            candidate
                          )
                        }
                      >
                        View
                      </button>

                      <button
                        className="candidate-delete-btn"
                        title={`Delete ${candidate.name}`}
                        aria-label={`Delete ${candidate.name}`}
                        onClick={() =>
                          handleDeleteCandidate(
                            candidate.id
                          )
                        }
                      >
                        🗑
                      </button>

                    </div>

                  </div>

                )
              )

            )}

          </div>

        </section>

      </main>

      {/* =====================================
          ADD CANDIDATE MODAL
      ===================================== */}

      {showAddModal && (

        <div
          className="candidate-modal-overlay"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget
            ) {
              closeAddModal()
            }
          }}
        >

          <div className="candidate-modal">

            <div className="candidate-modal__header">

              <div>

                <span className="pill pill--live">
                  <span className="dot" />
                  New candidate
                </span>

                <h2>
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
              >
                ×
              </button>

            </div>

            <form onSubmit={handleAddCandidate}>

              <div className="candidate-form-grid">

                <div className="candidate-form-field">
                  <label>
                    Candidate name
                  </label>

                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleFormChange}
                    placeholder="e.g. Rahul Kumar"
                  />
                </div>

                <div className="candidate-form-field">
                  <label>
                    Candidate role
                  </label>

                  <input
                    type="text"
                    name="role"
                    value={form.role}
                    onChange={handleFormChange}
                    placeholder="e.g. Frontend Developer"
                  />
                </div>

                <div className="candidate-form-field candidate-form-field--full">
                  <label>
                    Skills
                  </label>

                  <input
                    type="text"
                    name="skills"
                    value={form.skills}
                    onChange={handleFormChange}
                    placeholder="e.g. React · JavaScript · CSS"
                  />
                </div>

                <div className="candidate-form-field">
                  <label>
                    Email
                  </label>

                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleFormChange}
                    placeholder="candidate@email.com"
                  />
                </div>

                <div className="candidate-form-field">
                  <label>
                    Status
                  </label>

                  <select
                    name="status"
                    value={form.status}
                    onChange={handleFormChange}
                  >
                    {STATUS_OPTIONS.map(
                      (status) => (
                        <option
                          key={status}
                          value={status}
                        >
                          {status}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div className="candidate-form-field candidate-form-field--full">

                  <label>
                    Additional information
                  </label>

                  <textarea
                    name="notes"
                    value={form.notes}
                    onChange={handleFormChange}
                    placeholder="Add extra skills, certifications, experience, strengths or any other notes..."
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
                      {form.resume
                        ? form.resume
                        : 'PDF, DOC or DOCX'}
                    </span>

                  </div>

                  <input
                    ref={candidateResumeRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleCandidateResume}
                    style={{
                      display: 'none',
                    }}
                  />

                </div>

              </div>

              <div className="candidate-modal__actions">

                <button
                  type="button"
                  className="btn"
                  onClick={closeAddModal}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="btn btn--primary"
                >
                  Add candidate
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

      {/* =====================================
          VIEW CANDIDATE MODAL
      ===================================== */}

      {showViewModal &&
        selectedCandidate && (

          <div
            className="candidate-modal-overlay"
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget
              ) {
                setShowViewModal(false)
              }
            }}
          >

            <div className="candidate-modal">

              <div className="candidate-modal__header">

                <div>

                  <span
                    className={`pill pill--${selectedCandidate.statusType}`}
                  >
                    <span className="dot" />
                    {selectedCandidate.status}
                  </span>

                  <h2>
                    {selectedCandidate.name}
                  </h2>

                  <p>
                    Candidate profile
                  </p>

                </div>

                <button
                  type="button"
                  className="modal-close"
                  onClick={() =>
                    setShowViewModal(false)
                  }
                >
                  ×
                </button>

              </div>

              <div className="candidate-details">

                <div className="candidate-detail">
                  <span>Role</span>

                  <strong>
                    {selectedCandidate.role}
                  </strong>
                </div>

                <div className="candidate-detail">
                  <span>Skills</span>

                  <strong>
                    {selectedCandidate.skills}
                  </strong>
                </div>

                <div className="candidate-detail">
                  <span>Email</span>

                  <strong>
                    {selectedCandidate.email ||
                      'Not provided'}
                  </strong>
                </div>

                <div className="candidate-detail">

                  <span>
                    Resume
                  </span>

                  <strong>

                    {selectedCandidate.resume ? (

                      <a
                        href={
                          selectedCandidate.resume
                        }
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

                  <span>
                    Additional information
                  </span>

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
                    handleDeleteCandidate(
                      selectedCandidate.id
                    )
                  }
                >
                  Delete candidate
                </button>

                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() =>
                    setShowViewModal(false)
                  }
                >
                  Close
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