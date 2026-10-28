import { NavLink } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../auth.jsx'
import './Candidates.css'

import {
  collection,
  addDoc,
  doc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  increment,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'

import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'

import { db, storage } from '../firebase'

/* =========================================
   CONSTANTS
========================================= */

const STATUSES = [
  'Screening',
  'JD Matched',
  'Shortlisted',
  'Interview Scheduled',
  'Interview Ready',
  'Resume Reviewed',
  'Interview Pending',
  'Hired',
  'Rejected',
]

// Stages where a candidate is finished, so no follow-up is needed.
const CLOSED_STATUSES = ['Hired', 'Rejected']

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'status', label: 'By stage' },
  { value: 'rating', label: 'Top rated' },
]

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RESUME_SIZE = 10 * 1024 * 1024
const MAX_IMPORT_SIZE = 5 * 1024 * 1024
const MAX_IMPORT_ROWS = 1000
const PAGE_SIZE = 50
const UNDO_WINDOW_MS = 8000
const FOLLOW_UP_MS = 7 * DAY_MS
// Each candidate can write 2 docs (candidate + activity), so 200 stays under Firestore's 500 limit.
const BATCH_SIZE = 200

const DEFAULT_EMAIL_DOMAIN = 'gmail.com'
const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com']

const ALLOWED_RESUME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const ALLOWED_RESUME_EXTENSIONS = /\.(pdf|doc|docx)$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY_FORM = { name: '', role: '', email: '', phone: '', notes: '' }

const FOCUSABLE =
  'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

// One-click emails. They open in the recruiter's own mail app, pre-filled.
const EMAIL_TEMPLATES = [
  {
    key: 'invite',
    label: 'Invite to interview',
    subject: (c) => `Interview invitation: ${c.role || 'your application'}`,
    body: (c, sender) =>
      `Hi ${firstName(c.name)},\n\nThank you for applying${
        c.role ? ` for the ${c.role} role` : ''
      }. We were impressed by your profile and would like to invite you for an interview.\n\nCould you please share your availability over the next few days?\n\nBest regards,\n${sender}`,
  },
  {
    key: 'info',
    label: 'Ask for details',
    subject: (c) => `A few details needed: ${c.role || 'your application'}`,
    body: (c, sender) =>
      `Hi ${firstName(c.name)},\n\nThank you for your interest${
        c.role ? ` in the ${c.role} role` : ''
      }. To move forward, could you please send us your updated resume and your current notice period?\n\nBest regards,\n${sender}`,
  },
  {
    key: 'reject',
    label: 'Polite rejection',
    subject: (c) => `Your application${c.role ? `: ${c.role}` : ''}`,
    body: (c, sender) =>
      `Hi ${firstName(c.name)},\n\nThank you for the time you put into applying${
        c.role ? ` for the ${c.role} role` : ''
      }. After careful consideration, we have decided to move forward with other candidates at this time.\n\nWe will keep your details on file and wish you every success ahead.\n\nBest regards,\n${sender}`,
  },
]

/* =========================================
   HELPERS
========================================= */

function getStatusType(status = '') {
  const s = status.toLowerCase()

  if (s === 'interview ready' || s === 'hired') return 'live'
  if (s === 'jd matched' || s === 'resume reviewed' || s === 'shortlisted') return 'ok'
  if (s === 'rejected') return 'danger'

  return 'warn'
}

function getErrorMessage(error) {
  switch (error?.code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'You don’t have permission to do this. Please sign in again and retry.'
    case 'storage/unauthorized':
      return 'File storage refused the request. Please sign in again and retry.'
    case 'storage/canceled':
      return 'The resume upload was cancelled.'
    case 'storage/quota-exceeded':
      return 'Your storage space is full, so the file could not be saved.'
    case 'unavailable':
      return 'We couldn’t reach the server. Check your connection and try again.'
    default:
      return error?.message || 'Something went wrong. Please try again.'
  }
}

function validateResume(file) {
  if (!file) return ''

  const validExtension = ALLOWED_RESUME_EXTENSIONS.test(file.name)
  const validMimeType = !file.type || ALLOWED_RESUME_TYPES.includes(file.type)

  if (!validExtension || !validMimeType) {
    return 'That file type isn’t supported. Please upload a PDF, DOC or DOCX.'
  }
  if (file.size > MAX_RESUME_SIZE) {
    return 'That file is too large. Please upload a resume under 10 MB.'
  }
  return ''
}

function normalizeCandidate(id, data) {
  const createdMs = data.createdAt?.toMillis?.() ?? Date.now()

  return {
    id,
    name: data.name || '',
    role: data.role || '',
    email: data.email || '',
    phone: data.phone || '',
    status: data.status || 'Screening',
    notes: data.additionalinformation || data.notes || '',
    resumeUrl: data.resumeUrl || data.resume || '',
    resumeName: data.resumeName || '',
    resumePath: data.resumePath || '',
    ratingSum: Number(data.ratingSum) || 0,
    ratingCount: Number(data.ratingCount) || 0,
    createdMs,
    updatedMs: data.updatedAt?.toMillis?.() ?? createdMs,
  }
}

// The one place that decides what a stored candidate looks like.
function toCandidateDoc(ownerId, values, extra = {}) {
  return {
    ownerId,
    name: values.name,
    role: values.role,
    email: values.email,
    phone: values.phone,
    status: 'Screening',
    additionalinformation: values.notes,
    resumeUrl: '',
    resumeName: '',
    resumePath: '',
    ratingSum: 0,
    ratingCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...extra,
  }
}

// Runs writes in safe-sized Firestore batches.
async function commitInBatches(items, apply) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    items.slice(i, i + BATCH_SIZE).forEach((item) => apply(batch, item))
    await batch.commit()
  }
}

const candidateRef = (id) => doc(db, 'candidates', id)
const newActivityRef = (id) => doc(collection(db, 'candidates', id, 'activity'))

function isTyping(target) {
  const tag = target?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable
}

function useDebounced(value, delay = 200) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

// Safe CSV cell: quotes values and defuses spreadsheet formulas.
function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

// Small CSV reader that understands quotes, commas and line breaks in cells.
function parseCsv(input) {
  const text = input.replace(/^\ufeff/, '')
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || 'there'
}

const formatDate = (ms) =>
  new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

const formatDateTime = (ms) =>
  new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

function stars(value) {
  const full = Math.max(0, Math.min(5, Math.round(value)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

function averageRating(candidate) {
  return candidate.ratingCount > 0 ? candidate.ratingSum / candidate.ratingCount : 0
}

function isStale(candidate) {
  return (
    !CLOSED_STATUSES.includes(candidate.status) &&
    Date.now() - candidate.updatedMs > FOLLOW_UP_MS
  )
}

function daysSince(ms) {
  return Math.max(0, Math.floor((Date.now() - ms) / DAY_MS))
}

/* ---------- email + phone helpers ---------- */

// "rahul" -> "rahul@gmail.com", "rahul@" -> "rahul@gmail.com"
function normalizeEmail(value = '') {
  const text = value.trim().toLowerCase().replace(/\s+/g, '')
  if (!text) return ''
  if (!text.includes('@')) return `${text}@${DEFAULT_EMAIL_DOMAIN}`
  if (text.endsWith('@')) return `${text}${DEFAULT_EMAIL_DOMAIN}`
  return text
}

// Suggestions shown while typing: pick one with a tap instead of typing it all.
function getEmailSuggestions(value = '') {
  const text = value.trim().toLowerCase().replace(/\s+/g, '')
  if (!text) return []

  const atIndex = text.indexOf('@')
  const local = atIndex === -1 ? text : text.slice(0, atIndex)
  const typedDomain = atIndex === -1 ? '' : text.slice(atIndex + 1)

  if (!local) return []

  return EMAIL_DOMAINS.filter(
    (domain) => domain.startsWith(typedDomain) && domain !== typedDomain
  ).map((domain) => ({ local, domain, value: `${local}@${domain}` }))
}

function normalizePhone(value = '') {
  const text = value.trim()
  if (!text) return ''
  const digits = text.replace(/\D/g, '')
  return text.startsWith('+') ? `+${digits}` : digits
}

// Last 10 digits, so "+91 98765 43210" and "98765 43210" count as the same.
const phoneKey = (value = '') => value.replace(/\D/g, '').slice(-10)

function buildMailto(candidate, template, sender) {
  const subject = encodeURIComponent(template.subject(candidate))
  const body = encodeURIComponent(template.body(candidate, sender))
  return `mailto:${encodeURIComponent(candidate.email)}?subject=${subject}&body=${body}`
}

/* =========================================
   SMALL SHARED PIECES
========================================= */

function CandidateTags({ candidate }) {
  const average = averageRating(candidate)
  const stale = isStale(candidate)

  if (!average && !stale) return null

  return (
    <span className="candidate-tags">
      {average > 0 && (
        <span
          className="candidate-tag candidate-tag--rating"
          title={`${plural(candidate.ratingCount, 'interview rating')}`}
        >
          ★ {average.toFixed(1)}
        </span>
      )}

      {stale && (
        <span
          className="candidate-tag candidate-tag--stale"
          title={`No update for ${daysSince(candidate.updatedMs)} days`}
        >
          Follow up
        </span>
      )}
    </span>
  )
}

// One stage dropdown, used in the table and in the profile.
function StageSelect({ candidate, busy, onChange }) {
  return (
    <select
      className={`candidate-status-select pill--${getStatusType(candidate.status)}`}
      value={candidate.status}
      disabled={busy}
      onChange={(event) => onChange(candidate, event.target.value)}
      aria-label={`Update status for ${candidate.name}`}
    >
      {STATUSES.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  )
}

// One modal shell, same markup as the Jobs page modals.
function Modal({ onClose, labelledBy, role = 'dialog', describedBy, small = false, children }) {
  return (
    <div
      className="modal"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section
        className={`modal__card cand-modal glass glass--strong${small ? ' cand-modal--small' : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </section>
    </div>
  )
}

function ModalHead({ id, title, text, badge, onClose, closeLabel, disabled }) {
  return (
    <div className="modal__head">
      <div>
        {badge}
        <h3 id={id}>{title}</h3>
        {text && <p>{text}</p>}
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={onClose}
        disabled={disabled}
        aria-label={closeLabel}
      >
        ×
      </button>
    </div>
  )
}

function StatusBadge({ status }) {
  return (
    <span className={`pill pill--${getStatusType(status)}`}>
      <span className="dot" />
      {status}
    </span>
  )
}

function Detail({ label, children }) {
  return (
    <div className="candidate-detail">
      <span>{label}</span>
      {children}
    </div>
  )
}

function DialogIcon({ tone, children }) {
  return (
    <div className={`candidate-dialog-icon candidate-dialog-icon--${tone}`} aria-hidden="true">
      {children}
    </div>
  )
}

/* =========================================
   MAIN COMPONENT
========================================= */

export default function Candidates() {
  const { user, signOut } = useAuth()

  const initials = (user?.name || user?.displayName || user?.email || 'U')
    .slice(0, 2)
    .toUpperCase()

  const actorName = user?.name || user?.displayName || user?.email || 'You'

  const fileInputRef = useRef(null)
  const importInputRef = useRef(null)
  const searchRef = useRef(null)
  const nameInputRef = useRef(null)
  const highlightTimer = useRef(null)
  // candidateId -> { timer, path } : resume file is removed once Undo expires
  const pendingResumeDeletes = useRef(new Map())

  const [candidates, setCandidates] = useState([])
  const [jobTitles, setJobTitles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatingStatusId, setUpdatingStatusId] = useState(null)
  const [uploadingIds, setUploadingIds] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteTargets, setDeleteTargets] = useState([])
  const [notice, setNotice] = useState(null)
  const [highlightId, setHighlightId] = useState(null)

  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput, 200)
  const [filterStatus, setFilterStatus] = useState('All')
  const [sortBy, setSortBy] = useState('newest')
  const [view, setView] = useState('list')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragOverStatus, setDragOverStatus] = useState(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const [selectedFile, setSelectedFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [emailFocused, setEmailFocused] = useState(false)

  const [activity, setActivity] = useState([])
  const [feedbackRating, setFeedbackRating] = useState(0)
  const [feedbackText, setFeedbackText] = useState('')
  const [savingFeedback, setSavingFeedback] = useState(false)

  const [toasts, setToasts] = useState([])

  const isBoard = view === 'board'
  const isEditing = Boolean(editingId)

  /* ---------- toasts ---------- */

  const dismissToast = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback(
    (type, message, options = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const duration = options.duration ?? (type === 'error' ? 7000 : 3500)

      setToasts((previous) => [
        ...previous.slice(-2),
        { id, type, message, actionLabel: options.actionLabel, onAction: options.onAction },
      ])

      setTimeout(() => dismissToast(id), duration)
      return id
    },
    [dismissToast]
  )

  const flashRow = useCallback((id) => {
    setHighlightId(id)
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2000)
  }, [])

  /* ---------- activity history (who did what, and when) ---------- */

  const activityEntry = useCallback(
    (type, text, extra = {}) => ({
      type,
      text,
      ...extra,
      by: actorName,
      byUid: user?.uid,
      createdAt: serverTimestamp(),
    }),
    [user?.uid, actorName]
  )

  const logActivity = useCallback(
    (candidateId, type, text) => {
      if (!user?.uid || !candidateId) return Promise.resolve()

      return addDoc(
        collection(db, 'candidates', candidateId, 'activity'),
        activityEntry(type, text)
      ).catch((error) => {
        console.warn('Activity not saved:', error?.code || error)
      })
    },
    [user?.uid, activityEntry]
  )

  /* ---------- never leave a deleted candidate's resume behind ---------- */

  useEffect(() => {
    const pending = pendingResumeDeletes.current

    return () => {
      clearTimeout(highlightTimer.current)

      // If the page is left during the undo window, finish the cleanup now.
      pending.forEach(({ timer, path }) => {
        clearTimeout(timer)
        deleteObject(ref(storage, path)).catch(() => {})
      })
      pending.clear()
    }
  }, [])

  /* ---------- live candidates (no manual reload) ---------- */

  useEffect(() => {
    if (!user?.uid) {
      setCandidates([])
      setLoading(false)
      return undefined
    }

    setLoading(true)

    return onSnapshot(
      query(collection(db, 'candidates'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const loaded = snapshot.docs.map((candidateDoc) =>
          normalizeCandidate(
            candidateDoc.id,
            candidateDoc.data({ serverTimestamps: 'estimate' })
          )
        )

        loaded.sort((a, b) => b.createdMs - a.createdMs)
        setCandidates(loaded)
        setLoading(false)
      },
      (error) => {
        console.error('Failed to load candidates:', error)
        setLoading(false)
        pushToast('error', getErrorMessage(error))
      }
    )
  }, [user?.uid, pushToast])

  /* ---------- job titles for the role suggestions ---------- */

  useEffect(() => {
    if (!user?.uid) {
      setJobTitles([])
      return undefined
    }

    return onSnapshot(
      query(collection(db, 'jobs'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const titles = snapshot.docs
          .map((jobDoc) => {
            const data = jobDoc.data()
            return String(data.title || data.jobTitle || data.role || data.name || '').trim()
          })
          .filter(Boolean)

        setJobTitles([...new Set(titles)].sort((a, b) => a.localeCompare(b)))
      },
      (error) => {
        console.warn('Job suggestions unavailable:', error?.code || error)
        setJobTitles([])
      }
    )
  }, [user?.uid])

  /* ---------- timeline for the open profile ---------- */

  useEffect(() => {
    setFeedbackRating(0)
    setFeedbackText('')
    setActivity([])

    if (!selectedId || !user?.uid) return undefined

    return onSnapshot(
      query(
        collection(db, 'candidates', selectedId, 'activity'),
        orderBy('createdAt', 'desc'),
        limit(25)
      ),
      (snapshot) => {
        setActivity(
          snapshot.docs.map((item) => {
            const data = item.data({ serverTimestamps: 'estimate' })
            return {
              id: item.id,
              type: data.type || 'note',
              text: data.text || '',
              rating: Number(data.rating) || 0,
              by: data.by || '',
              ms: data.createdAt?.toMillis?.() ?? Date.now(),
            }
          })
        )
      },
      (error) => {
        console.warn('History unavailable:', error?.code || error)
        setActivity([])
      }
    )
  }, [selectedId, user?.uid])

  /* ---------- derived data ---------- */

  const selectedCandidate = useMemo(
    () => candidates.find((item) => item.id === selectedId) || null,
    [candidates, selectedId]
  )

  const editingCandidate = useMemo(
    () => candidates.find((item) => item.id === editingId) || null,
    [candidates, editingId]
  )

  const statusCounts = useMemo(() => {
    const counts = {}
    candidates.forEach((candidate) => {
      counts[candidate.status] = (counts[candidate.status] || 0) + 1
    })
    return counts
  }, [candidates])

  const followUpCount = useMemo(() => candidates.filter(isStale).length, [candidates])

  const filteredCandidates = useMemo(() => {
    const searchTerm = search.trim().toLowerCase()

    const list = candidates.filter((candidate) => {
      if (filterStatus === 'Follow-up') {
        if (!isStale(candidate)) return false
      } else if (filterStatus !== 'All' && candidate.status !== filterStatus) {
        return false
      }
      if (!searchTerm) return true

      return [
        candidate.name,
        candidate.email,
        candidate.phone,
        candidate.role,
        candidate.status,
        candidate.notes,
      ]
        .join(' ')
        .toLowerCase()
        .includes(searchTerm)
    })

    list.sort((a, b) => {
      if (sortBy === 'oldest') return a.createdMs - b.createdMs
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      }
      if (sortBy === 'status') {
        return (
          STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || b.createdMs - a.createdMs
        )
      }
      if (sortBy === 'rating') {
        return averageRating(b) - averageRating(a) || b.createdMs - a.createdMs
      }
      return b.createdMs - a.createdMs
    })

    return list
  }, [candidates, search, filterStatus, sortBy])

  const shownCandidates = filteredCandidates.slice(0, visibleCount)

  const boardGroups = useMemo(() => {
    const groups = Object.fromEntries(STATUSES.map((status) => [status, []]))
    filteredCandidates.forEach((candidate) => groups[candidate.status]?.push(candidate))
    return groups
  }, [filteredCandidates])

  const selectedList = useMemo(
    () => candidates.filter((candidate) => selectedIds.has(candidate.id)),
    [candidates, selectedIds]
  )

  const allShownSelected =
    shownCandidates.length > 0 &&
    shownCandidates.every((candidate) => selectedIds.has(candidate.id))
  const someShownSelected = shownCandidates.some((candidate) => selectedIds.has(candidate.id))

  const chips = useMemo(
    () => [
      { key: 'All', label: 'All', count: candidates.length },
      ...(followUpCount > 0 || filterStatus === 'Follow-up'
        ? [{ key: 'Follow-up', label: 'Needs follow-up', count: followUpCount }]
        : []),
      ...STATUSES.filter((status) => statusCounts[status] || status === filterStatus).map(
        (status) => ({ key: status, label: status, count: statusCounts[status] || 0 })
      ),
    ],
    [statusCounts, candidates.length, followUpCount, filterStatus]
  )

  const emailSuggestions = useMemo(
    () => (emailFocused ? getEmailSuggestions(form.email) : []),
    [emailFocused, form.email]
  )

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    // A selection that is no longer on screen shouldn't be acted on by mistake.
    setSelectedIds(new Set())
  }, [search, filterStatus, sortBy, view])

  // Drop selections for candidates that no longer exist.
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous
      const existing = new Set(candidates.map((candidate) => candidate.id))
      const next = new Set([...previous].filter((id) => existing.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [candidates])

  /* ---------- selection helpers ---------- */

  function toggleSelected(id) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      shownCandidates.forEach((candidate) =>
        allShownSelected ? next.delete(candidate.id) : next.add(candidate.id)
      )
      return next
    })
  }

  /* ---------- form helpers ---------- */

  function updateForm(event) {
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
  }

  // When the recruiter leaves the email box, finish the address for them.
  function handleEmailBlur() {
    setEmailFocused(false)
    setForm((previous) => {
      const fixed = normalizeEmail(previous.email)
      return fixed === previous.email ? previous : { ...previous, email: fixed }
    })
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setSelectedFile(null)
    setFormError('')
    setDragging(false)
    setEditingId(null)
    setEmailFocused(false)

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const openAddModal = useCallback(() => {
    resetForm()
    setShowAddModal(true)
  }, [])

  function openEditModal(candidate) {
    resetForm()
    setSelectedId(null)
    setForm({
      name: candidate.name,
      role: candidate.role,
      email: candidate.email,
      phone: candidate.phone,
      notes: candidate.notes,
    })
    setEditingId(candidate.id)
    setShowAddModal(true)
  }

  const closeAddModal = useCallback(() => {
    if (saving) return
    setShowAddModal(false)
    resetForm()
  }, [saving])

  function acceptFile(file) {
    setFormError('')

    const validationError = validateResume(file)

    if (validationError) {
      setFormError(validationError)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setSelectedFile(file || null)
  }

  function handleDrop(event) {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files?.[0] || null)
  }

  /* ---------- keyboard shortcuts + dialog focus ---------- */

  const dialogOpen =
    showAddModal || Boolean(selectedId) || deleteTargets.length > 0 || Boolean(notice)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (notice) setNotice(null)
        else if (deleteTargets.length > 0) {
          if (!deleting) setDeleteTargets([])
        } else if (showAddModal) closeAddModal()
        else if (selectedId) setSelectedId(null)
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target) || dialogOpen) return

      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openAddModal()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    showAddModal,
    selectedId,
    notice,
    deleteTargets,
    deleting,
    dialogOpen,
    closeAddModal,
    openAddModal,
  ])

  // Keep Tab focus inside the open dialog.
  useEffect(() => {
    if (!dialogOpen) return undefined

    function onTab(event) {
      if (event.key !== 'Tab') return

      const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]')
      const top = dialogs[dialogs.length - 1]
      if (!top) return

      const focusable = [...top.querySelectorAll(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null
      )
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (!top.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onTab)
    return () => window.removeEventListener('keydown', onTab)
  }, [dialogOpen])

  /* ---------- resume upload (runs in the background) ---------- */

  async function removeStoredFile(path) {
    try {
      await deleteObject(ref(storage, path))
    } catch (error) {
      if (error?.code !== 'storage/object-not-found') {
        console.error('Resume cleanup failed:', error)
      }
    }
  }

  async function uploadResume(candidateId, file, previousPath = '') {
    setUploadingIds((previous) => new Set(previous).add(candidateId))

    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `resumes/${user.uid}/${Date.now()}-${safeFileName}`
    let uploaded = false

    try {
      const resumeReference = ref(storage, path)

      await uploadBytes(resumeReference, file, {
        contentType: file.type || 'application/octet-stream',
      })
      uploaded = true

      const resumeUrl = await getDownloadURL(resumeReference)

      await updateDoc(candidateRef(candidateId), {
        resumeUrl,
        resumeName: file.name,
        resumePath: path,
        updatedAt: serverTimestamp(),
      })

      logActivity(
        candidateId,
        'resume',
        previousPath ? `Resume replaced (${file.name})` : `Resume attached (${file.name})`
      )

      // The new resume is saved, so the replaced one can go.
      if (previousPath && previousPath !== path) await removeStoredFile(previousPath)

      pushToast('success', previousPath ? 'Resume replaced' : 'Resume attached to the profile')
    } catch (error) {
      console.error('Resume upload failed:', error)

      if (uploaded) await removeStoredFile(path)

      pushToast(
        'error',
        `Candidate saved, but the resume couldn’t be uploaded. ${getErrorMessage(error)}`
      )
    } finally {
      setUploadingIds((previous) => {
        const next = new Set(previous)
        next.delete(candidateId)
        return next
      })
    }
  }

  /* ---------- shared form validation ---------- */

  function validateForm(excludeId = null) {
    if (!user?.uid) {
      return { error: 'Your session has expired. Please sign in to continue.' }
    }

    const name = form.name.trim()
    const role = form.role.trim()
    const email = normalizeEmail(form.email)
    const phone = normalizePhone(form.phone)
    const notes = form.notes.trim()

    if (!name || !role || !email) {
      return { error: 'Please add a name, job role and email to continue.' }
    }

    if (!EMAIL_PATTERN.test(email)) {
      return { error: 'That email doesn’t look right. Please check it and try again.' }
    }

    if (phone) {
      const digitCount = phone.replace(/\D/g, '').length
      if (digitCount < 7 || digitCount > 15) {
        return {
          error: 'That phone number doesn’t look right. Use 7 to 15 digits, or leave it empty.',
        }
      }
    }

    const others = candidates.filter((candidate) => candidate.id !== excludeId)

    const duplicate = others.find((candidate) => candidate.email.toLowerCase() === email)
    if (duplicate) {
      return { error: `${duplicate.name} is already on your list with this email address.` }
    }

    const duplicatePhone =
      phone && others.find((c) => c.phone && phoneKey(c.phone) === phoneKey(phone))
    if (duplicatePhone) {
      return { error: `${duplicatePhone.name} is already on your list with this phone number.` }
    }

    const resumeError = validateResume(selectedFile)
    if (resumeError) return { error: resumeError }

    return { values: { name, role, email, phone, notes } }
  }

  /* ---------- add + edit candidate ---------- */

  async function handleAddCandidate(keepOpen = false) {
    const { error, values } = validateForm()

    if (error) {
      setFormError(error)
      return
    }

    const fileToUpload = selectedFile

    setSaving(true)
    setFormError('')

    try {
      const documentReference = await addDoc(
        collection(db, 'candidates'),
        toCandidateDoc(user.uid, values)
      )

      logActivity(documentReference.id, 'created', 'Added to the pipeline at Screening')

      resetForm()

      if (keepOpen) nameInputRef.current?.focus()
      else setShowAddModal(false)

      flashRow(documentReference.id)

      if (keepOpen) {
        pushToast('success', `${values.name} added. Ready for the next one.`)
      } else {
        setNotice({
          type: 'added',
          candidateId: documentReference.id,
          name: values.name,
          role: values.role,
          email: values.email,
          resumeName: fileToUpload?.name || '',
        })
      }

      if (fileToUpload) uploadResume(documentReference.id, fileToUpload)
    } catch (addError) {
      console.error('Failed to add candidate:', addError)
      setFormError(getErrorMessage(addError))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateCandidate() {
    if (!editingCandidate) {
      setFormError('This candidate is no longer on your list.')
      return
    }

    const { error, values } = validateForm(editingCandidate.id)

    if (error) {
      setFormError(error)
      return
    }

    const fileToUpload = selectedFile
    const previousPath = editingCandidate.resumePath
    const candidateId = editingCandidate.id

    setSaving(true)
    setFormError('')

    try {
      await updateDoc(candidateRef(candidateId), {
        name: values.name,
        role: values.role,
        email: values.email,
        phone: values.phone,
        additionalinformation: values.notes,
        updatedAt: serverTimestamp(),
      })

      logActivity(candidateId, 'edited', 'Profile details updated')

      setShowAddModal(false)
      resetForm()

      flashRow(candidateId)
      pushToast('success', `${values.name} updated`)

      if (fileToUpload) uploadResume(candidateId, fileToUpload, previousPath)
    } catch (updateError) {
      console.error('Failed to update candidate:', updateError)
      setFormError(getErrorMessage(updateError))
    } finally {
      setSaving(false)
    }
  }

  function handleSubmit(event, keepOpen = false) {
    event.preventDefault()

    if (saving) return

    if (editingId) handleUpdateCandidate()
    else handleAddCandidate(keepOpen)
  }

  /* ---------- update status ---------- */

  async function handleStatusChange(candidate, newStatus) {
    if (!user?.uid || !candidate?.id || !newStatus || candidate.status === newStatus) return

    const previousStatus = candidate.status
    const setStatus = (status, extra = {}) =>
      setCandidates((previous) =>
        previous.map((item) =>
          item.id === candidate.id ? { ...item, status, ...extra } : item
        )
      )

    setUpdatingStatusId(candidate.id)

    // Instant UI update; the live listener confirms it.
    setStatus(newStatus, { updatedMs: Date.now() })

    try {
      await updateDoc(candidateRef(candidate.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      })

      logActivity(candidate.id, 'status', `Moved from ${previousStatus} to ${newStatus}`)

      pushToast('success', `${candidate.name} moved to ${newStatus}`, { duration: 2500 })
    } catch (error) {
      console.error('Failed to update candidate status:', error)
      setStatus(previousStatus)
      pushToast('error', `Status wasn’t changed. ${getErrorMessage(error)}`)
    } finally {
      setUpdatingStatusId(null)
    }
  }

  /* ---------- bulk: move many candidates to one stage ---------- */

  async function handleBulkStatus(newStatus) {
    if (!user?.uid || !newStatus || selectedList.length === 0) return

    const targets = selectedList.filter((candidate) => candidate.status !== newStatus)

    if (targets.length === 0) {
      pushToast('success', `Everyone selected is already at ${newStatus}`, { duration: 2500 })
      return
    }

    setBulkBusy(true)

    try {
      await commitInBatches(targets, (batch, candidate) => {
        batch.update(candidateRef(candidate.id), {
          status: newStatus,
          updatedAt: serverTimestamp(),
        })
        batch.set(
          newActivityRef(candidate.id),
          activityEntry('status', `Moved from ${candidate.status} to ${newStatus}`)
        )
      })

      setSelectedIds(new Set())
      pushToast('success', `${plural(targets.length, 'candidate')} moved to ${newStatus}`)
    } catch (error) {
      console.error('Bulk status change failed:', error)
      pushToast('error', `Stages weren’t changed. ${getErrorMessage(error)}`)
    } finally {
      setBulkBusy(false)
    }
  }

  /* ---------- delete (confirm first, then 8s to undo) ---------- */

  async function handleDeleteCandidates() {
    const list = deleteTargets
    if (!user?.uid || list.length === 0) return

    setDeleting(true)

    try {
      await commitInBatches(list, (batch, candidate) =>
        batch.delete(candidateRef(candidate.id))
      )

      const removedIds = new Set(list.map((candidate) => candidate.id))

      setDeleteTargets([])
      if (removedIds.has(selectedId)) setSelectedId(null)
      setSelectedIds((previous) => new Set([...previous].filter((id) => !removedIds.has(id))))

      // Keep resume files until the undo window closes,
      // so a restored candidate still has their resume.
      list.forEach((candidate) => {
        if (!candidate.resumePath) return

        const timer = setTimeout(() => {
          pendingResumeDeletes.current.delete(candidate.id)
          removeStoredFile(candidate.resumePath)
        }, UNDO_WINDOW_MS + 500)

        pendingResumeDeletes.current.set(candidate.id, { timer, path: candidate.resumePath })
      })

      const label = list.length === 1 ? list[0].name : `${list.length} candidates`

      pushToast('success', `${label} removed from your list`, {
        duration: UNDO_WINDOW_MS,
        actionLabel: 'Undo',
        onAction: () => handleUndoDelete(list),
      })
    } catch (error) {
      console.error('Failed to delete candidates:', error)
      setDeleteTargets([])
      setNotice({
        type: 'error',
        title: 'Couldn’t remove candidate',
        message: `${list.length === 1 ? list[0].name : 'These candidates'} ${
          list.length === 1 ? 'is' : 'are'
        } still on your list. ${getErrorMessage(error)}`,
      })
    } finally {
      setDeleting(false)
    }
  }

  async function handleUndoDelete(list) {
    if (!user?.uid || list.length === 0) return

    list.forEach((candidate) => {
      const pending = pendingResumeDeletes.current.get(candidate.id)
      if (pending) {
        clearTimeout(pending.timer)
        pendingResumeDeletes.current.delete(candidate.id)
      }
    })

    try {
      await commitInBatches(list, (batch, candidate) =>
        batch.set(
          candidateRef(candidate.id),
          toCandidateDoc(
            user.uid,
            { ...candidate },
            {
              status: candidate.status,
              resumeUrl: candidate.resumeUrl,
              resumeName: candidate.resumeName,
              resumePath: candidate.resumePath,
              ratingSum: candidate.ratingSum,
              ratingCount: candidate.ratingCount,
              createdAt: Timestamp.fromMillis(candidate.createdMs),
            }
          )
        )
      )

      if (list.length === 1) flashRow(list[0].id)

      pushToast(
        'success',
        list.length === 1
          ? `${list[0].name} is back on your list`
          : `${list.length} candidates are back on your list`
      )
    } catch (error) {
      console.error('Failed to restore candidates:', error)
      pushToast('error', `Couldn’t restore them. ${getErrorMessage(error)}`)
    }
  }

  /* ---------- interview feedback + rating ---------- */

  async function handleSaveFeedback() {
    if (!user?.uid || !selectedCandidate) return

    if (!feedbackRating) {
      pushToast('error', 'Choose a rating from 1 to 5 stars first.')
      return
    }

    const candidateId = selectedCandidate.id

    setSavingFeedback(true)

    try {
      const batch = writeBatch(db)

      batch.update(candidateRef(candidateId), {
        ratingSum: increment(feedbackRating),
        ratingCount: increment(1),
        updatedAt: serverTimestamp(),
      })
      batch.set(
        newActivityRef(candidateId),
        activityEntry('feedback', feedbackText.trim(), { rating: feedbackRating })
      )

      await batch.commit()

      setFeedbackRating(0)
      setFeedbackText('')
      pushToast('success', 'Feedback saved', { duration: 2500 })
    } catch (error) {
      console.error('Failed to save feedback:', error)
      pushToast('error', `Feedback wasn’t saved. ${getErrorMessage(error)}`)
    } finally {
      setSavingFeedback(false)
    }
  }

  /* ---------- export to CSV ---------- */

  function exportCandidates(list) {
    if (list.length === 0) return

    const rows = [
      ['Name', 'Email', 'Phone', 'Role', 'Status', 'Rating', 'Notes', 'Resume link', 'Added on'],
      ...list.map((candidate) => [
        candidate.name,
        candidate.email,
        candidate.phone,
        candidate.role,
        candidate.status,
        averageRating(candidate) ? averageRating(candidate).toFixed(1) : '',
        candidate.notes,
        candidate.resumeUrl,
        new Date(candidate.createdMs).toLocaleDateString(),
      ]),
    ]

    const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')

    link.href = url
    link.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)

    pushToast('success', `Exported ${plural(list.length, 'candidate')}`, { duration: 2500 })
  }

  /* ---------- import from CSV ---------- */

  async function handleImportFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !user?.uid) return

    if (!/\.csv$/i.test(file.name)) {
      pushToast('error', 'Please choose a .csv file.')
      return
    }

    if (file.size > MAX_IMPORT_SIZE) {
      pushToast('error', 'That file is too large. Please keep it under 5 MB.')
      return
    }

    setImporting(true)

    try {
      const rows = parseCsv(await file.text())

      if (rows.length < 2) throw new Error('That file has no candidate rows.')

      const headers = rows[0].map((header) => header.trim().toLowerCase())
      const column = (...names) => headers.findIndex((header) => names.includes(header))
      const cell = (row, index, max) =>
        index === -1 ? '' : (row[index] || '').trim().slice(0, max)

      const nameIndex = column('name', 'full name')
      const emailIndex = column('email', 'email address')
      const roleIndex = column('role', 'job role', 'applying for', 'position')
      const phoneIndex = column('phone', 'mobile', 'phone number')
      const notesIndex = column('notes', 'note', 'additional information')

      if (nameIndex === -1 || emailIndex === -1) {
        throw new Error('The file needs at least a "Name" and an "Email" column.')
      }

      const knownEmails = new Set(candidates.map((candidate) => candidate.email.toLowerCase()))
      const toAdd = []
      let skippedInvalid = 0
      let skippedDuplicate = 0

      rows.slice(1).forEach((row) => {
        if (row.every((value) => !value.trim())) return

        const name = cell(row, nameIndex, 100)
        const email = normalizeEmail(row[emailIndex] || '')

        if (!name || !EMAIL_PATTERN.test(email)) {
          skippedInvalid += 1
          return
        }

        if (knownEmails.has(email)) {
          skippedDuplicate += 1
          return
        }

        knownEmails.add(email)

        toAdd.push({
          name,
          email,
          role: cell(row, roleIndex, 150) || 'Not specified',
          phone: normalizePhone(cell(row, phoneIndex, 30)),
          notes: cell(row, notesIndex, 3000),
        })
      })

      if (toAdd.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `That file has ${toAdd.length} new candidates. Please import up to ${MAX_IMPORT_ROWS} at a time.`
        )
      }

      await commitInBatches(toAdd, (batch, item) =>
        batch.set(doc(collection(db, 'candidates')), toCandidateDoc(user.uid, item))
      )

      setNotice({ type: 'import', added: toAdd.length, skippedInvalid, skippedDuplicate })
    } catch (error) {
      console.error('Import failed:', error)
      pushToast('error', getErrorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  /* ---------- board: drag a card to a new stage ---------- */

  function handleBoardDrop(event, status) {
    event.preventDefault()
    setDragOverStatus(null)

    const id = event.dataTransfer.getData('text/plain')
    const candidate = candidates.find((item) => item.id === id)

    if (candidate) handleStatusChange(candidate, status)
  }

  /* =========================================
     UI
  ========================================= */

  const currentResumeName = isEditing ? editingCandidate?.resumeName || '' : ''
  const hasCurrentResume = isEditing && Boolean(editingCandidate?.resumeUrl)
  const deleteIsMany = deleteTargets.length > 1
  const hasFilters = Boolean(search) || filterStatus !== 'All'

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
        <NavLink to="/profile" className="avatar" title={user?.email}>
          {initials}
        </NavLink>
        <button className="btn btn--ghost" onClick={signOut}>
          Log out
        </button>
      </header>

      <main className="page jobs-page">
        <section className="jobs-page__head">
          <div>
            <span className="eyebrow">Your workspace</span>
            <h1>Candidates</h1>
            <p>Manage candidates, review resumes, and track each one through your hiring process.</p>
          </div>

          <div className="cand-head__actions">
            <button
              type="button"
              className="btn"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              title="Add many candidates from a CSV file (Name, Email, Role, Phone, Notes)"
            >
              {importing ? 'Importing…' : 'Import CSV'}
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => exportCandidates(filteredCandidates)}
              disabled={filteredCandidates.length === 0}
              title="Download the candidates shown as a CSV file"
            >
              Export CSV
            </button>

            <button className="btn btn--primary jobs-page__add" onClick={openAddModal}>
              <span aria-hidden="true">＋</span> Add candidate
            </button>

            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportFile}
              aria-label="Import candidates from a CSV file"
              className="visually-hidden"
            />
          </div>
        </section>

        <section className="jobs-table-wrap glass glass--lg cand-panel">
          <div className="cand-toolbar">
            <div className="candidate-search">
              <input
                ref={searchRef}
                type="search"
                placeholder="Search name, email, role or notes"
                aria-label="Search candidates"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {!searchInput && <kbd aria-hidden="true">/</kbd>}
            </div>

            <select
              className="candidate-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              aria-label="Sort candidates"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="candidate-view-toggle" role="group" aria-label="Choose layout">
              {['list', 'board'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={view === mode ? 'is-active' : ''}
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                >
                  {mode === 'list' ? 'List' : 'Board'}
                </button>
              ))}
            </div>
          </div>

          {!isBoard && (
            <div className="candidate-chips" role="group" aria-label="Filter by status">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={`candidate-chip ${
                    filterStatus === chip.key ? 'candidate-chip--active' : ''
                  }`}
                  aria-pressed={filterStatus === chip.key}
                  onClick={() => setFilterStatus(chip.key)}
                >
                  {chip.label}
                  <span className="candidate-chip__count">{chip.count}</span>
                </button>
              ))}
            </div>
          )}

          {!isBoard && selectedList.length > 0 && (
            <div className="bulk-bar" role="region" aria-label="Bulk actions">
              <b>{selectedList.length} selected</b>

              <select
                className="candidate-sort bulk-bar__select"
                value=""
                onChange={(event) => handleBulkStatus(event.target.value)}
                disabled={bulkBusy}
                aria-label="Move selected candidates to a stage"
              >
                <option value="" disabled>
                  {bulkBusy ? 'Updating…' : 'Move to stage…'}
                </option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn btn--small"
                onClick={() => exportCandidates(selectedList)}
              >
                Export
              </button>

              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => setDeleteTargets(selectedList)}
                disabled={bulkBusy}
              >
                Delete
              </button>

              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          )}

          {loading ? (
            <div className="jobs-empty" aria-busy="true">
              <span className="jobs-empty__icon">···</span>
              <h2>Loading your candidates</h2>
              <p>Getting the latest candidates from your workspace.</p>
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="jobs-empty">
              <span className="jobs-empty__icon">{hasFilters ? '⌕' : '＋'}</span>
              {hasFilters ? (
                <>
                  <h2>No matches</h2>
                  <p>No candidates match your search or filter.</p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSearchInput('')
                      setFilterStatus('All')
                    }}
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <h2>No candidates yet</h2>
                  <p>Add your first candidate, or import a CSV to get started.</p>
                  <button type="button" className="btn btn--primary" onClick={openAddModal}>
                    Add your first candidate
                  </button>
                </>
              )}
            </div>
          ) : isBoard ? (
            <div className="candidate-board" aria-label="Hiring pipeline">
              {STATUSES.map((status) => {
                const items = boardGroups[status]

                return (
                  <div
                    key={status}
                    className={`board-col ${dragOverStatus === status ? 'board-col--over' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOverStatus(status)
                    }}
                    onDragLeave={() =>
                      setDragOverStatus((current) => (current === status ? null : current))
                    }
                    onDrop={(event) => handleBoardDrop(event, status)}
                  >
                    <div className="board-col__head">
                      <StatusBadge status={status} />
                      <span className="candidate-chip__count">{items.length}</span>
                    </div>

                    <div className="board-col__body">
                      {items.length === 0 ? (
                        <p className="board-col__empty">Drop a card here</p>
                      ) : (
                        items.map((candidate) => (
                          <div
                            key={candidate.id}
                            className={`board-card ${
                              highlightId === candidate.id ? 'candidate--new' : ''
                            }`}
                            draggable
                            tabIndex={0}
                            role="button"
                            aria-label={`Open ${candidate.name}`}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', candidate.id)
                              event.dataTransfer.effectAllowed = 'move'
                            }}
                            onClick={() => setSelectedId(candidate.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setSelectedId(candidate.id)
                              }
                            }}
                          >
                            <b>{candidate.name}</b>
                            <span>{candidate.role}</span>
                            <CandidateTags candidate={candidate} />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="jobs-table-scroll">
              <table className="jobs-table cand-table">
                <thead>
                  <tr>
                    <th className="cand-table__check">
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate = someShownSelected && !allShownSelected
                          }
                        }}
                        onChange={toggleSelectAll}
                        aria-label="Select all candidates shown"
                      />
                    </th>
                    <th>Candidate</th>
                    <th>Role</th>
                    <th>Stage</th>
                    <th>Added</th>
                    <th>
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {shownCandidates.map((candidate) => {
                    const isUploading = uploadingIds.has(candidate.id)
                    const isChecked = selectedIds.has(candidate.id)

                    return (
                      <tr
                        key={candidate.id}
                        className={`${highlightId === candidate.id ? 'candidate--new' : ''} ${
                          isChecked ? 'candidate--selected' : ''
                        }`}
                      >
                        <td className="cand-table__check">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelected(candidate.id)}
                            aria-label={`Select ${candidate.name}`}
                          />
                        </td>

                        <td data-label="Candidate">
                          <button
                            type="button"
                            className="candidate__name"
                            onClick={() => setSelectedId(candidate.id)}
                            aria-label={`Open ${candidate.name}`}
                          >
                            <b className="job-title">{candidate.name}</b>
                            <small>{candidate.email || 'Candidate profile'}</small>
                          </button>
                          <CandidateTags candidate={candidate} />
                        </td>

                        <td data-label="Role">{candidate.role}</td>

                        <td data-label="Stage">
                          <StageSelect
                            candidate={candidate}
                            busy={updatingStatusId === candidate.id}
                            onChange={handleStatusChange}
                          />
                        </td>

                        <td data-label="Added">{formatDate(candidate.createdMs)}</td>

                        <td className="jobs-table__actions">
                          {isUploading ? (
                            <span className="candidate-resume-state candidate-resume-state--busy">
                              Uploading…
                            </span>
                          ) : candidate.resumeUrl ? (
                            <a
                              className="btn btn--small"
                              href={candidate.resumeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Resume
                            </a>
                          ) : (
                            <span className="candidate-resume-state">No resume</span>
                          )}

                          <button
                            type="button"
                            className="btn btn--primary btn--small"
                            onClick={() => setSelectedId(candidate.id)}
                          >
                            View
                          </button>

                          <button
                            type="button"
                            className="cand-icon-btn"
                            title={`Edit ${candidate.name}`}
                            aria-label={`Edit ${candidate.name}`}
                            onClick={() => openEditModal(candidate)}
                          >
                            ✎
                          </button>

                          <button
                            type="button"
                            className="cand-icon-btn cand-icon-btn--danger"
                            title={`Delete ${candidate.name}`}
                            aria-label={`Delete ${candidate.name}`}
                            onClick={() => setDeleteTargets([candidate])}
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {filteredCandidates.length > shownCandidates.length && (
                <div className="candidates__more">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  >
                    Show more ({filteredCandidates.length - shownCandidates.length} left)
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {!loading && candidates.length > 0 && (
          <p className="jobs-page__count">
            {plural(filteredCandidates.length, 'candidate')}
            {hasFilters ? ` of ${candidates.length}` : ''}
          </p>
        )}
      </main>

      <footer className="footer">
        Who’s Next assists interviewers. Hiring decisions stay with you.
      </footer>

      {/* ---------- add / edit candidate ---------- */}

      {showAddModal && (
        <Modal onClose={closeAddModal} labelledBy="candidate-add-title">
          <ModalHead
            id="candidate-add-title"
            title={isEditing ? 'Edit candidate' : 'Add a candidate'}
            text={
              isEditing
                ? 'Update their details or replace the resume. Their hiring stage stays the same.'
                : 'Start with a name, role and email. Phone, resume and notes are optional.'
            }
            onClose={closeAddModal}
            disabled={saving}
            closeLabel="Close candidate form"
          />

          <form onSubmit={handleSubmit} noValidate>
            <div className="cand-form-grid">
              <div className="field">
                <label htmlFor="candidate-name">Full name *</label>
                <input
                  ref={nameInputRef}
                  id="candidate-name"
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={updateForm}
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
                  type="text"
                  name="role"
                  value={form.role}
                  onChange={updateForm}
                  placeholder="e.g. Frontend Developer"
                  maxLength={150}
                  autoComplete="off"
                  list="candidate-role-options"
                  required
                />
                <datalist id="candidate-role-options">
                  {jobTitles.map((title) => (
                    <option key={title} value={title} />
                  ))}
                </datalist>
              </div>

              <div className="field">
                <label htmlFor="candidate-email">Email address *</label>
                <input
                  id="candidate-email"
                  type="text"
                  inputMode="email"
                  name="email"
                  value={form.email}
                  onChange={updateForm}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={handleEmailBlur}
                  placeholder="just type the name, e.g. rahul.kumar"
                  maxLength={254}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-describedby="candidate-email-hint"
                  required
                />

                {emailSuggestions.length > 0 ? (
                  <div className="email-suggest" role="listbox" aria-label="Email suggestions">
                    {emailSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.value}
                        type="button"
                        role="option"
                        aria-selected="false"
                        // keep the input focused so the tap doesn't trigger blur first
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          setForm((previous) => ({ ...previous, email: suggestion.value }))
                        }
                      >
                        {suggestion.local}
                        <strong>@{suggestion.domain}</strong>
                      </button>
                    ))}
                  </div>
                ) : (
                  <small id="candidate-email-hint" className="hint">
                    @{DEFAULT_EMAIL_DOMAIN} is added for you.
                  </small>
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
                  onChange={updateForm}
                  placeholder="e.g. +91 98765 43210"
                  maxLength={20}
                  autoComplete="off"
                />
              </div>

              <div className="field cand-form-grid__full">
                <label htmlFor="candidate-resume">
                  {isEditing ? 'Resume' : 'Resume (optional)'}
                </label>

                <div
                  className={`resume-upload-box ${dragging ? 'resume-upload-box--drag' : ''} ${
                    selectedFile ? 'resume-upload-box--filled' : ''
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {selectedFile || hasCurrentResume ? 'Change resume' : 'Choose resume'}
                  </button>

                  <span>
                    {selectedFile
                      ? selectedFile.name
                      : hasCurrentResume
                        ? `Current: ${currentResumeName || 'Resume on file'} · choose a file to replace it`
                        : 'Drag and drop here · PDF, DOC or DOCX · up to 10 MB'}
                  </span>
                </div>

                <input
                  ref={fileInputRef}
                  id="candidate-resume"
                  type="file"
                  className="visually-hidden"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => acceptFile(event.target.files?.[0] || null)}
                  aria-label="Upload candidate resume"
                />
              </div>

              <div className="field cand-form-grid__full">
                <label htmlFor="candidate-notes">Notes (optional)</label>
                <textarea
                  id="candidate-notes"
                  name="notes"
                  value={form.notes}
                  onChange={updateForm}
                  placeholder="Skills, referral source, salary expectations, anything worth remembering…"
                  rows="3"
                  maxLength={3000}
                />
              </div>
            </div>

            {formError && (
              <div role="alert" className="candidate-form-error">
                {formError}
              </div>
            )}

            <div className="modal__actions">
              <button type="button" className="btn" onClick={closeAddModal} disabled={saving}>
                Cancel
              </button>

              {!isEditing && (
                <button
                  type="button"
                  className="btn"
                  onClick={(event) => handleSubmit(event, true)}
                  disabled={saving}
                >
                  Save &amp; add another
                </button>
              )}

              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save candidate'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- candidate profile ---------- */}

      {selectedCandidate && (
        <Modal onClose={() => setSelectedId(null)} labelledBy="candidate-details-title">
          <ModalHead
            id="candidate-details-title"
            badge={<StatusBadge status={selectedCandidate.status} />}
            title={selectedCandidate.name}
            text={
              selectedCandidate.role
                ? `${selectedCandidate.role} · Candidate profile`
                : 'Candidate profile'
            }
            onClose={() => setSelectedId(null)}
            closeLabel="Close candidate details"
          />

          {isStale(selectedCandidate) && (
            <div className="candidate-followup" role="note">
              No update for {daysSince(selectedCandidate.updatedMs)} days. Move them to the next
              stage, add feedback, or send a quick email below.
            </div>
          )}

          <div className="candidate-details">
            <Detail label="Hiring stage">
              <StageSelect
                candidate={selectedCandidate}
                busy={updatingStatusId === selectedCandidate.id}
                onChange={handleStatusChange}
              />
            </Detail>

            <Detail label="Applying for">
              <strong>{selectedCandidate.role || 'Role not specified'}</strong>
            </Detail>

            <Detail label="Email address">
              <strong>
                {selectedCandidate.email ? (
                  <a href={`mailto:${selectedCandidate.email}`}>{selectedCandidate.email}</a>
                ) : (
                  'No email on file'
                )}
              </strong>
            </Detail>

            <Detail label="Phone">
              <strong>
                {selectedCandidate.phone ? (
                  <a href={`tel:${selectedCandidate.phone}`}>{selectedCandidate.phone}</a>
                ) : (
                  'No phone on file'
                )}
              </strong>
            </Detail>

            <Detail label="Resume">
              <strong>
                {uploadingIds.has(selectedCandidate.id) ? (
                  'Uploading resume…'
                ) : selectedCandidate.resumeUrl ? (
                  <a href={selectedCandidate.resumeUrl} target="_blank" rel="noopener noreferrer">
                    {selectedCandidate.resumeName || 'Open resume'}
                  </a>
                ) : (
                  'No resume attached yet'
                )}
              </strong>
            </Detail>

            <Detail label="Notes">
              <strong className="candidate-notes">
                {selectedCandidate.notes || 'No notes added yet.'}
              </strong>
            </Detail>

            <Detail label="Added on">
              <strong>{formatDate(selectedCandidate.createdMs)}</strong>
            </Detail>

            <Detail label="Quick email">
              {selectedCandidate.email ? (
                <div className="email-templates">
                  {EMAIL_TEMPLATES.map((template) => (
                    <a
                      key={template.key}
                      className="btn btn--small"
                      href={buildMailto(selectedCandidate, template, actorName)}
                      onClick={() =>
                        logActivity(
                          selectedCandidate.id,
                          'email',
                          `Email drafted: ${template.label}`
                        )
                      }
                    >
                      {template.label}
                    </a>
                  ))}
                </div>
              ) : (
                <strong>No email on file</strong>
              )}
            </Detail>

            <Detail
              label={`Interview feedback${
                selectedCandidate.ratingCount > 0
                  ? ` · average ${averageRating(selectedCandidate).toFixed(1)} from ${
                      selectedCandidate.ratingCount
                    }`
                  : ''
              }`}
            >
              <div className="rating-input" role="group" aria-label="Rate this candidate">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={value <= feedbackRating ? 'is-on' : ''}
                    aria-pressed={feedbackRating === value}
                    aria-label={`${plural(value, 'star')}`}
                    onClick={() => setFeedbackRating(feedbackRating === value ? 0 : value)}
                  >
                    ★
                  </button>
                ))}
              </div>

              <textarea
                className="feedback-input"
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
                placeholder="What stood out in the interview? Strengths, concerns, next steps…"
                rows="2"
                maxLength={1000}
                aria-label="Interview feedback"
              />

              <button
                type="button"
                className="btn btn--small feedback-save"
                onClick={handleSaveFeedback}
                disabled={savingFeedback}
              >
                {savingFeedback ? 'Saving…' : 'Save feedback'}
              </button>
            </Detail>

            <Detail label="History">
              {activity.length === 0 ? (
                <strong className="candidate-notes">Changes and feedback will appear here.</strong>
              ) : (
                <ol className="timeline">
                  {activity.map((item) => (
                    <li
                      key={item.id}
                      className={`timeline__item timeline__item--${item.type}`}
                    >
                      <span className="timeline__dot" aria-hidden="true" />

                      <div>
                        <p>
                          {item.type === 'feedback' && (
                            <span className="timeline__stars">{stars(item.rating)} </span>
                          )}
                          {item.text || (item.type === 'feedback' ? 'Rated' : '')}
                        </p>
                        <small>
                          {item.by ? `${item.by} · ` : ''}
                          {formatDateTime(item.ms)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Detail>
          </div>

          <div className="modal__actions modal__actions--split">
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => setDeleteTargets([selectedCandidate])}
            >
              Delete candidate
            </button>

            <div className="cand-actions-group">
              <button type="button" className="btn" onClick={() => openEditModal(selectedCandidate)}>
                Edit
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setSelectedId(null)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---------- delete confirmation ---------- */}

      {deleteTargets.length > 0 && (
        <Modal
          small
          role="alertdialog"
          onClose={() => !deleting && setDeleteTargets([])}
          labelledBy="candidate-delete-title"
          describedBy="candidate-delete-text"
        >
          <DialogIcon tone="danger">🗑</DialogIcon>

          <h3 id="candidate-delete-title" className="cand-dialog__title">
            {deleteIsMany
              ? `Remove ${deleteTargets.length} candidates?`
              : 'Remove this candidate?'}
          </h3>

          <div className="dialog-person">
            <span className="dialog-person__avatar" aria-hidden="true">
              {deleteIsMany ? deleteTargets.length : getInitials(deleteTargets[0].name)}
            </span>

            <div className="dialog-person__info">
              {deleteIsMany ? (
                <>
                  <b>
                    {deleteTargets
                      .slice(0, 3)
                      .map((candidate) => candidate.name)
                      .join(', ')}
                    {deleteTargets.length > 3 ? ` and ${deleteTargets.length - 3} more` : ''}
                  </b>
                  <span>Selected candidates</span>
                </>
              ) : (
                <>
                  <b>{deleteTargets[0].name}</b>
                  <span>
                    {[deleteTargets[0].role, deleteTargets[0].status].filter(Boolean).join(' · ')}
                  </span>
                </>
              )}
            </div>
          </div>

          <p id="candidate-delete-text" className="cand-dialog__text">
            {deleteIsMany
              ? 'Their profiles, notes and resumes will be taken off your list.'
              : 'Their profile, notes and resume will be taken off your list.'}{' '}
            Changed your mind? You can undo for a few seconds right after.
          </p>

          <div className="modal__actions">
            <button
              type="button"
              className="btn"
              onClick={() => setDeleteTargets([])}
              disabled={deleting}
              autoFocus
            >
              {deleteIsMany ? 'Keep them' : 'Keep candidate'}
            </button>

            <button
              type="button"
              className="btn btn--danger btn--danger-solid"
              onClick={handleDeleteCandidates}
              disabled={deleting}
            >
              {deleting ? 'Removing…' : 'Yes, remove'}
            </button>
          </div>
        </Modal>
      )}

      {/* ---------- success / import / error ---------- */}

      {notice && (
        <Modal
          small
          role="alertdialog"
          onClose={() => setNotice(null)}
          labelledBy="candidate-notice-title"
        >
          {notice.type === 'added' && (
            <>
              <DialogIcon tone="success">✓</DialogIcon>
              <h3 id="candidate-notice-title" className="cand-dialog__title">
                Candidate added
              </h3>
              <p className="cand-dialog__text">
                <strong>{notice.name}</strong> is now in your pipeline and ready for screening.
              </p>

              <dl className="notice-summary">
                <div>
                  <dt>Applying for</dt>
                  <dd>{notice.role}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{notice.email}</dd>
                </div>
                <div>
                  <dt>Stage</dt>
                  <dd>Screening</dd>
                </div>
                <div>
                  <dt>Resume</dt>
                  <dd>
                    {notice.resumeName ? `${notice.resumeName} · uploading` : 'Not attached yet'}
                  </dd>
                </div>
              </dl>

              <div className="notice-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setNotice(null)}
                  autoFocus
                >
                  Done
                </button>

                <div className="notice-actions__row">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setNotice(null)
                      setSelectedId(notice.candidateId)
                    }}
                  >
                    View profile
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setNotice(null)
                      openAddModal()
                    }}
                  >
                    Add another
                  </button>
                </div>
              </div>
            </>
          )}

          {notice.type === 'import' && (
            <>
              <DialogIcon tone={notice.added > 0 ? 'success' : 'danger'}>
                {notice.added > 0 ? '✓' : '!'}
              </DialogIcon>
              <h3 id="candidate-notice-title" className="cand-dialog__title">
                {notice.added > 0 ? 'Import finished' : 'Nothing imported'}
              </h3>
              <p className="cand-dialog__text">
                {notice.added > 0
                  ? `${plural(notice.added, 'new candidate')} ${
                      notice.added === 1 ? 'was' : 'were'
                    } added at the Screening stage.`
                  : 'No new candidates were found in that file.'}
              </p>

              <dl className="notice-summary">
                <div>
                  <dt>Added</dt>
                  <dd>{notice.added}</dd>
                </div>
                <div>
                  <dt>Already on your list</dt>
                  <dd>{notice.skippedDuplicate}</dd>
                </div>
                <div>
                  <dt>Skipped (missing name or bad email)</dt>
                  <dd>{notice.skippedInvalid}</dd>
                </div>
              </dl>

              <div className="modal__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setNotice(null)}
                  autoFocus
                >
                  Done
                </button>
              </div>
            </>
          )}

          {notice.type === 'error' && (
            <>
              <DialogIcon tone="danger">!</DialogIcon>
              <h3 id="candidate-notice-title" className="cand-dialog__title">
                {notice.title}
              </h3>
              <p className="cand-dialog__text">{notice.message}</p>

              <div className="modal__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setNotice(null)}
                  autoFocus
                >
                  Got it
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ---------- toasts ---------- */}

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.type}`} key={toast.id}>
            <span className="toast__dot" />
            <span className="toast__text">{toast.message}</span>

            {toast.actionLabel && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.onAction?.()
                  dismissToast(toast.id)
                }}
              >
                {toast.actionLabel}
              </button>
            )}

            <button
              type="button"
              className="toast__close"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
            >
              
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}