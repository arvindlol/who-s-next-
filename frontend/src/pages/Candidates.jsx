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

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage'

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

const MATCHED_STATUSES = [
  'JD Matched',
  'Shortlisted',
  'Interview Scheduled',
  'Interview Ready',
  'Hired',
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

const MAX_RESUME_SIZE = 10 * 1024 * 1024
const MAX_IMPORT_SIZE = 5 * 1024 * 1024
const MAX_IMPORT_ROWS = 1000
const PAGE_SIZE = 50
const UNDO_WINDOW_MS = 8000
const FOLLOW_UP_DAYS = 7
const FOLLOW_UP_MS = FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000
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
  if (s === 'jd matched' || s === 'resume reviewed' || s === 'shortlisted')
    return 'ok'
  if (s === 'rejected') return 'danger'

  return 'warn'
}

function getErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'You don’t have permission to do this. Please sign in again and retry.'
  }
  if (code === 'storage/unauthorized') {
    return 'File storage refused the request. Please sign in again and retry.'
  }
  if (code === 'storage/canceled') return 'The resume upload was cancelled.'
  if (code === 'storage/quota-exceeded') {
    return 'Your storage space is full, so the file could not be saved.'
  }
  if (code === 'unavailable') {
    return 'We couldn’t reach the server. Check your connection and try again.'
  }

  return error?.message || 'Something went wrong. Please try again.'
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

function isTyping(target) {
  const tag = target?.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target?.isContentEditable
  )
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

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function stars(value) {
  const full = Math.max(0, Math.min(5, Math.round(value)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

function averageRating(candidate) {
  return candidate.ratingCount > 0
    ? candidate.ratingSum / candidate.ratingCount
    : 0
}

function isStale(candidate) {
  return (
    !CLOSED_STATUSES.includes(candidate.status) &&
    Date.now() - candidate.updatedMs > FOLLOW_UP_MS
  )
}

function daysSince(ms) {
  return Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)))
}

/* ---------- email + phone helpers ---------- */

// "rahul" -> "rahul@gmail.com", "rahul@" -> "rahul@gmail.com",
// "Rahul@Outlook.com" -> "rahul@outlook.com"
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
  )
    .slice(0, 4)
    .map((domain) => ({ local, domain, value: `${local}@${domain}` }))
}

function normalizePhone(value = '') {
  const text = value.trim()
  if (!text) return ''
  const digits = text.replace(/\D/g, '')
  return text.startsWith('+') ? `+${digits}` : digits
}

// Last 10 digits, so "+91 98765 43210" and "98765 43210" count as the same.
function phoneKey(value = '') {
  return value.replace(/\D/g, '').slice(-10)
}

function buildMailto(candidate, template, sender) {
  const subject = encodeURIComponent(template.subject(candidate))
  const body = encodeURIComponent(template.body(candidate, sender))
  return `mailto:${encodeURIComponent(candidate.email)}?subject=${subject}&body=${body}`
}

/* ---------- small shared pieces ---------- */

function CandidateTags({ candidate }) {
  const average = averageRating(candidate)
  const stale = isStale(candidate)

  if (!average && !stale) return null

  return (
    <span className="candidate-tags">
      {average > 0 && (
        <span
          className="candidate-tag candidate-tag--rating"
          title={`${candidate.ratingCount} interview rating${
            candidate.ratingCount === 1 ? '' : 's'
          }`}
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
        {
          id,
          type,
          message,
          actionLabel: options.actionLabel,
          onAction: options.onAction,
        },
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

  const logActivity = useCallback(
    (candidateId, entry) => {
      if (!user?.uid || !candidateId) return Promise.resolve()

      return addDoc(collection(db, 'candidates', candidateId, 'activity'), {
        ...entry,
        by: actorName,
        byUid: user.uid,
        createdAt: serverTimestamp(),
      }).catch((error) => {
        console.warn('Activity not saved:', error?.code || error)
      })
    },
    [user?.uid, actorName]
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

    const candidatesQuery = query(
      collection(db, 'candidates'),
      where('ownerId', '==', user.uid)
    )

    const unsubscribe = onSnapshot(
      candidatesQuery,
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

    return unsubscribe
  }, [user?.uid, pushToast])

  /* ---------- job titles for the role suggestions ---------- */
  // Assumes your Jobs page saves documents in a "jobs" collection with an
  // ownerId and a title. If it doesn't, the field simply stays free text.

  useEffect(() => {
    if (!user?.uid) {
      setJobTitles([])
      return undefined
    }

    const jobsQuery = query(
      collection(db, 'jobs'),
      where('ownerId', '==', user.uid)
    )

    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        const titles = snapshot.docs
          .map((jobDoc) => {
            const data = jobDoc.data()
            return String(
              data.title || data.jobTitle || data.role || data.name || ''
            ).trim()
          })
          .filter(Boolean)

        setJobTitles([...new Set(titles)].sort((a, b) => a.localeCompare(b)))
      },
      (error) => {
        console.warn('Job suggestions unavailable:', error?.code || error)
        setJobTitles([])
      }
    )

    return unsubscribe
  }, [user?.uid])

  /* ---------- timeline for the open profile ---------- */

  useEffect(() => {
    setFeedbackRating(0)
    setFeedbackText('')

    if (!selectedId || !user?.uid) {
      setActivity([])
      return undefined
    }

    setActivity([])

    const activityQuery = query(
      collection(db, 'candidates', selectedId, 'activity'),
      orderBy('createdAt', 'desc'),
      limit(25)
    )

    const unsubscribe = onSnapshot(
      activityQuery,
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

    return unsubscribe
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

  const followUpCount = useMemo(
    () => candidates.filter(isStale).length,
    [candidates]
  )

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
          STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
          b.createdMs - a.createdMs
        )
      }
      if (sortBy === 'rating') {
        return (
          averageRating(b) - averageRating(a) || b.createdMs - a.createdMs
        )
      }
      return b.createdMs - a.createdMs
    })

    return list
  }, [candidates, search, filterStatus, sortBy])

  const shownCandidates = filteredCandidates.slice(0, visibleCount)

  const boardGroups = useMemo(() => {
    const groups = {}
    STATUSES.forEach((status) => {
      groups[status] = []
    })
    filteredCandidates.forEach((candidate) => {
      if (groups[candidate.status]) groups[candidate.status].push(candidate)
    })
    return groups
  }, [filteredCandidates])

  const selectedList = useMemo(
    () => candidates.filter((candidate) => selectedIds.has(candidate.id)),
    [candidates, selectedIds]
  )

  const allShownSelected =
    shownCandidates.length > 0 &&
    shownCandidates.every((candidate) => selectedIds.has(candidate.id))
  const someShownSelected = shownCandidates.some((candidate) =>
    selectedIds.has(candidate.id)
  )

  const totalCandidates = candidates.length
  const matchedCandidates = useMemo(
    () =>
      candidates.filter((candidate) =>
        MATCHED_STATUSES.includes(candidate.status)
      ).length,
    [candidates]
  )
  const shortlistedCandidates = statusCounts.Shortlisted || 0

  const chips = useMemo(
    () => [
      { key: 'All', label: 'All', count: totalCandidates },
      ...(followUpCount > 0 || filterStatus === 'Follow-up'
        ? [{ key: 'Follow-up', label: 'Needs follow-up', count: followUpCount }]
        : []),
      ...STATUSES.filter(
        (status) => statusCounts[status] || status === filterStatus
      ).map((status) => ({
        key: status,
        label: status,
        count: statusCounts[status] || 0,
      })),
    ],
    [statusCounts, totalCandidates, followUpCount, filterStatus]
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
      if (allShownSelected) {
        shownCandidates.forEach((candidate) => next.delete(candidate.id))
      } else {
        shownCandidates.forEach((candidate) => next.add(candidate.id))
      }
      return next
    })
  }

  /* ---------- form helpers ---------- */

  function updateForm(event) {
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
  }

  function pickEmailSuggestion(value) {
    setForm((previous) => ({ ...previous, email: value }))
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

    if (!file) {
      setSelectedFile(null)
      return
    }

    const validationError = validateResume(file)

    if (validationError) {
      setFormError(validationError)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setSelectedFile(file)
  }

  function handleFileChange(event) {
    acceptFile(event.target.files?.[0] || null)
  }

  function handleDrop(event) {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files?.[0] || null)
  }

  /* ---------- keyboard shortcuts ---------- */

  const dialogOpen =
    showAddModal || Boolean(selectedId) || deleteTargets.length > 0 || notice

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

  /* ---------- keep Tab focus inside the open dialog ---------- */

  useEffect(() => {
    if (!dialogOpen) return undefined

    function onTab(event) {
      if (event.key !== 'Tab') return

      const dialogs = document.querySelectorAll(
        '[role="dialog"],[role="alertdialog"]'
      )
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

      await updateDoc(doc(db, 'candidates', candidateId), {
        resumeUrl,
        resumeName: file.name,
        resumePath: path,
        updatedAt: serverTimestamp(),
      })

      logActivity(candidateId, {
        type: 'resume',
        text: previousPath
          ? `Resume replaced (${file.name})`
          : `Resume attached (${file.name})`,
      })

      // The new resume is saved, so the replaced one can go.
      if (previousPath && previousPath !== path) {
        try {
          await deleteObject(ref(storage, previousPath))
        } catch (cleanupError) {
          if (cleanupError?.code !== 'storage/object-not-found') {
            console.error('Old resume cleanup failed:', cleanupError)
          }
        }
      }

      pushToast(
        'success',
        previousPath ? 'Resume replaced' : 'Resume attached to the profile'
      )
    } catch (error) {
      console.error('Resume upload failed:', error)

      if (uploaded) {
        try {
          await deleteObject(ref(storage, path))
        } catch (cleanupError) {
          console.error('Resume cleanup failed:', cleanupError)
        }
      }

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
      return {
        error: 'Your session has expired. Please sign in to continue.',
      }
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
      return {
        error: 'That email doesn’t look right. Please check it and try again.',
      }
    }

    if (phone) {
      const digitCount = phone.replace(/\D/g, '').length
      if (digitCount < 7 || digitCount > 15) {
        return {
          error:
            'That phone number doesn’t look right. Use 7 to 15 digits, or leave it empty.',
        }
      }
    }

    const duplicate = candidates.find(
      (candidate) =>
        candidate.id !== excludeId &&
        candidate.email.toLowerCase() === email
    )

    if (duplicate) {
      return {
        error: `${duplicate.name} is already on your list with this email address.`,
      }
    }

    if (phone) {
      const duplicatePhone = candidates.find(
        (candidate) =>
          candidate.id !== excludeId &&
          candidate.phone &&
          phoneKey(candidate.phone) === phoneKey(phone)
      )

      if (duplicatePhone) {
        return {
          error: `${duplicatePhone.name} is already on your list with this phone number.`,
        }
      }
    }

    const resumeError = validateResume(selectedFile)
    if (resumeError) return { error: resumeError }

    return { values: { name, role, email, phone, notes } }
  }

  /* ---------- add candidate ---------- */

  async function handleAddCandidate(keepOpen = false) {
    const { error, values } = validateForm()

    if (error) {
      setFormError(error)
      return
    }

    const { name, role, email, phone, notes } = values
    const fileToUpload = selectedFile

    setSaving(true)
    setFormError('')

    try {
      const documentReference = await addDoc(collection(db, 'candidates'), {
        ownerId: user.uid,
        name,
        role,
        email,
        phone,
        status: 'Screening',
        additionalinformation: notes,
        resumeUrl: '',
        resumeName: '',
        resumePath: '',
        ratingSum: 0,
        ratingCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      logActivity(documentReference.id, {
        type: 'created',
        text: 'Added to the pipeline at Screening',
      })

      resetForm()

      if (keepOpen) {
        nameInputRef.current?.focus()
      } else {
        setShowAddModal(false)
      }

      flashRow(documentReference.id)

      if (keepOpen) {
        pushToast('success', `${name} added. Ready for the next one.`)
      } else {
        setNotice({
          type: 'added',
          candidateId: documentReference.id,
          name,
          role,
          email,
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

  /* ---------- edit candidate ---------- */

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

    const { name, role, email, phone, notes } = values
    const fileToUpload = selectedFile
    const previousPath = editingCandidate.resumePath
    const candidateId = editingCandidate.id

    setSaving(true)
    setFormError('')

    try {
      await updateDoc(doc(db, 'candidates', candidateId), {
        name,
        role,
        email,
        phone,
        additionalinformation: notes,
        updatedAt: serverTimestamp(),
      })

      logActivity(candidateId, {
        type: 'edited',
        text: 'Profile details updated',
      })

      setShowAddModal(false)
      resetForm()

      flashRow(candidateId)
      pushToast('success', `${name} updated`)

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
    if (!user?.uid || !candidate?.id || !newStatus) return
    if (candidate.status === newStatus) return

    const previousStatus = candidate.status

    setUpdatingStatusId(candidate.id)

    // Instant UI update; the live listener confirms it.
    setCandidates((previous) =>
      previous.map((item) =>
        item.id === candidate.id
          ? { ...item, status: newStatus, updatedMs: Date.now() }
          : item
      )
    )

    try {
      await updateDoc(doc(db, 'candidates', candidate.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      })

      logActivity(candidate.id, {
        type: 'status',
        text: `Moved from ${previousStatus} to ${newStatus}`,
      })

      pushToast('success', `${candidate.name} moved to ${newStatus}`, {
        duration: 2500,
      })
    } catch (error) {
      console.error('Failed to update candidate status:', error)

      setCandidates((previous) =>
        previous.map((item) =>
          item.id === candidate.id ? { ...item, status: previousStatus } : item
        )
      )

      pushToast('error', `Status wasn’t changed. ${getErrorMessage(error)}`)
    } finally {
      setUpdatingStatusId(null)
    }
  }

  /* ---------- bulk: move many candidates to one stage ---------- */

  async function handleBulkStatus(newStatus) {
    if (!user?.uid || !newStatus || selectedList.length === 0) return

    const targets = selectedList.filter(
      (candidate) => candidate.status !== newStatus
    )

    if (targets.length === 0) {
      pushToast('success', `Everyone selected is already at ${newStatus}`, {
        duration: 2500,
      })
      return
    }

    setBulkBusy(true)

    try {
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)

        targets.slice(i, i + BATCH_SIZE).forEach((candidate) => {
          batch.update(doc(db, 'candidates', candidate.id), {
            status: newStatus,
            updatedAt: serverTimestamp(),
          })
          batch.set(doc(collection(db, 'candidates', candidate.id, 'activity')), {
            type: 'status',
            text: `Moved from ${candidate.status} to ${newStatus}`,
            by: actorName,
            byUid: user.uid,
            createdAt: serverTimestamp(),
          })
        })

        await batch.commit()
      }

      setSelectedIds(new Set())
      pushToast(
        'success',
        `${targets.length} candidate${
          targets.length === 1 ? '' : 's'
        } moved to ${newStatus}`
      )
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
      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db)
        list.slice(i, i + 400).forEach((candidate) => {
          batch.delete(doc(db, 'candidates', candidate.id))
        })
        await batch.commit()
      }

      const removedIds = new Set(list.map((candidate) => candidate.id))

      setDeleteTargets([])
      if (removedIds.has(selectedId)) setSelectedId(null)
      setSelectedIds((previous) => {
        const next = new Set(previous)
        removedIds.forEach((id) => next.delete(id))
        return next
      })

      // Keep resume files until the undo window closes,
      // so a restored candidate still has their resume.
      list.forEach((candidate) => {
        if (!candidate.resumePath) return

        const timer = setTimeout(async () => {
          pendingResumeDeletes.current.delete(candidate.id)
          try {
            await deleteObject(ref(storage, candidate.resumePath))
          } catch (storageError) {
            if (storageError?.code !== 'storage/object-not-found') {
              console.error('Resume cleanup failed:', storageError)
            }
          }
        }, UNDO_WINDOW_MS + 500)

        pendingResumeDeletes.current.set(candidate.id, {
          timer,
          path: candidate.resumePath,
        })
      })

      const label =
        list.length === 1 ? list[0].name : `${list.length} candidates`

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
        message: `${
          list.length === 1 ? list[0].name : 'These candidates'
        } ${list.length === 1 ? 'is' : 'are'} still on your list. ${getErrorMessage(error)}`,
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
      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db)

        list.slice(i, i + 400).forEach((candidate) => {
          batch.set(doc(db, 'candidates', candidate.id), {
            ownerId: user.uid,
            name: candidate.name,
            role: candidate.role,
            email: candidate.email,
            phone: candidate.phone,
            status: candidate.status,
            additionalinformation: candidate.notes,
            resumeUrl: candidate.resumeUrl,
            resumeName: candidate.resumeName,
            resumePath: candidate.resumePath,
            ratingSum: candidate.ratingSum,
            ratingCount: candidate.ratingCount,
            createdAt: Timestamp.fromMillis(candidate.createdMs),
            updatedAt: serverTimestamp(),
          })
        })

        await batch.commit()
      }

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
    const text = feedbackText.trim()

    setSavingFeedback(true)

    try {
      const batch = writeBatch(db)

      batch.update(doc(db, 'candidates', candidateId), {
        ratingSum: increment(feedbackRating),
        ratingCount: increment(1),
        updatedAt: serverTimestamp(),
      })

      batch.set(doc(collection(db, 'candidates', candidateId, 'activity')), {
        type: 'feedback',
        text,
        rating: feedbackRating,
        by: actorName,
        byUid: user.uid,
        createdAt: serverTimestamp(),
      })

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
      [
        'Name',
        'Email',
        'Phone',
        'Role',
        'Status',
        'Rating',
        'Notes',
        'Resume link',
        'Added on',
      ],
      ...list.map((candidate) => [
        candidate.name,
        candidate.email,
        candidate.phone,
        candidate.role,
        candidate.status,
        averageRating(candidate)
          ? averageRating(candidate).toFixed(1)
          : '',
        candidate.notes,
        candidate.resumeUrl,
        new Date(candidate.createdMs).toLocaleDateString(),
      ]),
    ]

    const csv =
      '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)

    pushToast(
      'success',
      `Exported ${list.length} candidate${list.length === 1 ? '' : 's'}`,
      { duration: 2500 }
    )
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

      if (rows.length < 2) {
        throw new Error('That file has no candidate rows.')
      }

      const headers = rows[0].map((header) => header.trim().toLowerCase())
      const column = (...names) =>
        headers.findIndex((header) => names.includes(header))

      const nameIndex = column('name', 'full name')
      const emailIndex = column('email', 'email address')
      const roleIndex = column('role', 'job role', 'applying for', 'position')
      const phoneIndex = column('phone', 'mobile', 'phone number')
      const notesIndex = column('notes', 'note', 'additional information')

      if (nameIndex === -1 || emailIndex === -1) {
        throw new Error('The file needs at least a "Name" and an "Email" column.')
      }

      const knownEmails = new Set(
        candidates.map((candidate) => candidate.email.toLowerCase())
      )
      const toAdd = []
      let skippedInvalid = 0
      let skippedDuplicate = 0

      rows.slice(1).forEach((row) => {
        if (row.every((cell) => !cell.trim())) return

        const name = (row[nameIndex] || '').trim().slice(0, 100)
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
          role:
            (roleIndex === -1 ? '' : row[roleIndex] || '').trim().slice(0, 150) ||
            'Not specified',
          phone: phoneIndex === -1 ? '' : normalizePhone(row[phoneIndex] || ''),
          notes: (notesIndex === -1 ? '' : row[notesIndex] || '')
            .trim()
            .slice(0, 3000),
        })
      })

      if (toAdd.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `That file has ${toAdd.length} new candidates. Please import up to ${MAX_IMPORT_ROWS} at a time.`
        )
      }

      for (let i = 0; i < toAdd.length; i += 400) {
        const batch = writeBatch(db)

        toAdd.slice(i, i + 400).forEach((item) => {
          batch.set(doc(collection(db, 'candidates')), {
            ownerId: user.uid,
            name: item.name,
            role: item.role,
            email: item.email,
            phone: item.phone,
            status: 'Screening',
            additionalinformation: item.notes,
            resumeUrl: '',
            resumeName: '',
            resumePath: '',
            ratingSum: 0,
            ratingCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        })

        await batch.commit()
      }

      setNotice({
        type: 'import',
        added: toAdd.length,
        skippedInvalid,
        skippedDuplicate,
      })
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

  const stop = (event) => event.stopPropagation()

  const isEditing = Boolean(editingId)
  const currentResumeName = isEditing ? editingCandidate?.resumeName || '' : ''
  const hasCurrentResume = isEditing && Boolean(editingCandidate?.resumeUrl)
  const isBoard = view === 'board'
  const deleteIsMany = deleteTargets.length > 1

  return (
    <div className="shell">
      <header className="topbar glass glass--strong">
        <Brand />

        <nav>
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/candidates">Candidates</NavLink>
          <NavLink to="/reports">Reports</NavLink>
        </nav>

        <span className="spacer" />

        <button className="btn btn--ghost" onClick={signOut}>
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

            <h1 style={{ marginTop: 14 }}>Candidates</h1>

            <p>
              Manage candidates, review resumes, and track each candidate
              through your hiring process.
            </p>

            <div className="hero__actions">
              <button className="btn btn--primary" onClick={openAddModal}>
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
              <b>{matchedCandidates}</b>
              <span>JD matched</span>
            </div>

            <div className="stat">
              <b>{shortlistedCandidates}</b>
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

              <div
                className="candidate-view-toggle"
                role="group"
                aria-label="Choose layout"
              >
                <button
                  type="button"
                  className={!isBoard ? 'is-active' : ''}
                  aria-pressed={!isBoard}
                  onClick={() => setView('list')}
                >
                  List
                </button>
                <button
                  type="button"
                  className={isBoard ? 'is-active' : ''}
                  aria-pressed={isBoard}
                  onClick={() => setView('board')}
                >
                  Board
                </button>
              </div>

              <button
                type="button"
                className="btn btn--small"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                title="Add many candidates from a CSV file (Name, Email, Role, Phone, Notes)"
              >
                {importing ? 'Importing…' : 'Import CSV'}
              </button>

              <button
                type="button"
                className="btn btn--small"
                onClick={() => exportCandidates(filteredCandidates)}
                disabled={filteredCandidates.length === 0}
                title="Download the candidates shown as a CSV file"
              >
                Export CSV
              </button>

              <input
                ref={importInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportFile}
                aria-label="Import candidates from a CSV file"
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="candidates glass glass--lg">
            {!isBoard && (
              <div
                className="candidate-chips"
                role="group"
                aria-label="Filter by status"
              >
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

            {!isBoard && (
              <div className="candidate__header candidate__header--selectable">
                <span className="candidate__select">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    ref={(element) => {
                      if (element) {
                        element.indeterminate =
                          someShownSelected && !allShownSelected
                      }
                    }}
                    onChange={toggleSelectAll}
                    disabled={shownCandidates.length === 0}
                    aria-label="Select all candidates shown"
                  />
                </span>
                <span>Candidate</span>
                <span>Role</span>
                <span>Status</span>
                <span>Action</span>
              </div>
            )}

            {loading ? (
              <div aria-label="Loading candidates" aria-busy="true">
                {[0, 1, 2, 3].map((item) => (
                  <div className="candidate-skeleton" key={item}>
                    <div>
                      <div className="skeleton-bar" />
                    </div>
                    <div className="skeleton-bar skeleton-bar--short" />
                    <div className="skeleton-bar skeleton-bar--pill" />
                    <div className="skeleton-bar skeleton-bar--btn" />
                  </div>
                ))}
              </div>
            ) : shownCandidates.length === 0 ? (
              <div className="empty-candidates">
                {search || filterStatus !== 'All' ? (
                  <>
                    <p>No candidates match your search or filter.</p>
                    <button
                      type="button"
                      className="btn btn--small"
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
                    <p>
                      No candidates yet. Add your first one, or import a CSV
                      to get started.
                    </p>
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      onClick={openAddModal}
                    >
                      Add candidate
                    </button>
                  </>
                )}
              </div>
            ) : isBoard ? (
              <div className="candidate-board" aria-label="Hiring pipeline">
                {STATUSES.map((status) => {
                  const items = boardGroups[status] || []

                  return (
                    <div
                      key={status}
                      className={`board-col ${
                        dragOverStatus === status ? 'board-col--over' : ''
                      }`}
                      onDragOver={(event) => {
                        event.preventDefault()
                        setDragOverStatus(status)
                      }}
                      onDragLeave={() =>
                        setDragOverStatus((current) =>
                          current === status ? null : current
                        )
                      }
                      onDrop={(event) => handleBoardDrop(event, status)}
                    >
                      <div className="board-col__head">
                        <span className={`pill pill--${getStatusType(status)}`}>
                          <span className="dot" />
                          {status}
                        </span>
                        <span className="candidate-chip__count">
                          {items.length}
                        </span>
                      </div>

                      <div className="board-col__body">
                        {items.length === 0 ? (
                          <p className="board-col__empty">Drop a card here</p>
                        ) : (
                          items.map((candidate) => (
                            <div
                              key={candidate.id}
                              className={`board-card ${
                                highlightId === candidate.id
                                  ? 'candidate--new'
                                  : ''
                              }`}
                              draggable
                              tabIndex={0}
                              role="button"
                              aria-label={`Open ${candidate.name}`}
                              onDragStart={(event) => {
                                event.dataTransfer.setData(
                                  'text/plain',
                                  candidate.id
                                )
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
              <>
                {shownCandidates.map((candidate) => {
                  const isUploading = uploadingIds.has(candidate.id)
                  const isChecked = selectedIds.has(candidate.id)

                  return (
                    <div
                      className={`candidate candidate--selectable ${
                        highlightId === candidate.id ? 'candidate--new' : ''
                      } ${isChecked ? 'candidate--selected' : ''}`}
                      key={candidate.id}
                      onClick={() => setSelectedId(candidate.id)}
                    >
                      <div className="candidate__select" onClick={stop}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelected(candidate.id)}
                          aria-label={`Select ${candidate.name}`}
                        />
                      </div>

                      <button
                        type="button"
                        className="candidate__name"
                        aria-label={`Open ${candidate.name}`}
                      >
                        <h3>{candidate.name}</h3>
                        <p>{candidate.email || 'Candidate profile'}</p>
                        <CandidateTags candidate={candidate} />
                      </button>

                      <div className="candidate__role">{candidate.role}</div>

                      <div className="candidate__status-cell" onClick={stop}>
                        <select
                          className={`candidate-status-select pill--${getStatusType(
                            candidate.status
                          )}`}
                          value={candidate.status}
                          disabled={updatingStatusId === candidate.id}
                          onChange={(event) =>
                            handleStatusChange(candidate, event.target.value)
                          }
                          aria-label={`Update status for ${candidate.name}`}
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="candidate__actions" onClick={stop}>
                        <div className="candidate__resume">
                          {isUploading ? (
                            <span className="candidate-resume-state candidate-resume-state--busy">
                              Uploading resume…
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
                            <span className="candidate-resume-state">
                              No resume
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => setSelectedId(candidate.id)}
                        >
                          View
                        </button>

                        <button
                          type="button"
                          className="candidate-icon-btn"
                          title={`Edit ${candidate.name}`}
                          aria-label={`Edit ${candidate.name}`}
                          onClick={() => openEditModal(candidate)}
                        >
                          ✎
                        </button>

                        <button
                          type="button"
                          className="candidate-delete-btn"
                          title={`Delete ${candidate.name}`}
                          aria-label={`Delete ${candidate.name}`}
                          onClick={() => setDeleteTargets([candidate])}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  )
                })}

                {filteredCandidates.length > shownCandidates.length && (
                  <div className="candidates__more">
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() =>
                        setVisibleCount((count) => count + PAGE_SIZE)
                      }
                    >
                      Show more (
                      {filteredCandidates.length - shownCandidates.length}{' '}
                      left)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      {/* =====================================
          ADD / EDIT CANDIDATE MODAL
      ===================================== */}

      {showAddModal && (
        <div
          className="candidate-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAddModal()
          }}
        >
          <div
            className="candidate-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="candidate-add-title"
          >
            <div className="candidate-modal__header">
              <div>
                <span className="pill pill--live">
                  <span className="dot" />
                  {isEditing ? 'Edit profile' : 'New candidate'}
                </span>

                <h2 id="candidate-add-title">
                  {isEditing ? 'Edit candidate' : 'Add a candidate'}
                </h2>

                <p>
                  {isEditing
                    ? 'Update their details or replace the resume. Their hiring stage stays the same.'
                    : 'Start with a name, role and email. Phone, resume and notes are optional and can be added now or later.'}
                </p>
              </div>

              <button
                type="button"
                className="modal-close"
                onClick={closeAddModal}
                disabled={saving}
                aria-label="Close candidate form"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className="candidate-form-grid">
                <div className="candidate-form-field">
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

                <div className="candidate-form-field">
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

                <div className="candidate-form-field">
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
                    <div
                      className="email-suggest"
                      role="listbox"
                      aria-label="Email suggestions"
                    >
                      {emailSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.value}
                          type="button"
                          role="option"
                          aria-selected="false"
                          // keep the input focused so the tap doesn't trigger blur first
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => pickEmailSuggestion(suggestion.value)}
                        >
                          {suggestion.local}
                          <strong>@{suggestion.domain}</strong>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span
                      id="candidate-email-hint"
                      className="candidate-form-hint"
                    >
                      @{DEFAULT_EMAIL_DOMAIN} is added for you.
                    </span>
                  )}
                </div>

                <div className="candidate-form-field">
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

                <div className="candidate-form-field candidate-form-field--full">
                  <label htmlFor="candidate-resume">
                    {isEditing ? 'Resume' : 'Resume (optional)'}
                  </label>

                  <div
                    className={`resume-upload-box ${
                      dragging ? 'resume-upload-box--drag' : ''
                    } ${selectedFile ? 'resume-upload-box--filled' : ''}`}
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
                      {selectedFile || hasCurrentResume
                        ? 'Change resume'
                        : 'Choose resume'}
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
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleFileChange}
                    aria-label="Upload candidate resume"
                    style={{ display: 'none' }}
                  />
                </div>

                <div className="candidate-form-field candidate-form-field--full">
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

              <div className="candidate-modal__actions">
                <button
                  type="button"
                  className="btn"
                  onClick={closeAddModal}
                  disabled={saving}
                >
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

                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : isEditing
                      ? 'Save changes'
                      : 'Save candidate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================
          VIEW CANDIDATE MODAL
      ===================================== */}

      {selectedCandidate && (
        <div
          className="candidate-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedId(null)
          }}
        >
          <div
            className="candidate-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="candidate-details-title"
          >
            <div className="candidate-modal__header">
              <div>
                <span
                  className={`pill pill--${getStatusType(
                    selectedCandidate.status
                  )}`}
                >
                  <span className="dot" />
                  {selectedCandidate.status}
                </span>

                <h2 id="candidate-details-title">{selectedCandidate.name}</h2>

                <p>
                  {selectedCandidate.role
                    ? `${selectedCandidate.role} · Candidate profile`
                    : 'Candidate profile'}
                </p>
              </div>

              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedId(null)}
                aria-label="Close candidate details"
              >
                ×
              </button>
            </div>

            {isStale(selectedCandidate) && (
              <div className="candidate-followup" role="note">
                No update for {daysSince(selectedCandidate.updatedMs)} days.
                Move them to the next stage, add feedback, or send a quick
                email below.
              </div>
            )}

            <div className="candidate-details">
              <div className="candidate-detail">
                <span>Hiring stage</span>

                <select
                  className={`candidate-status-select pill--${getStatusType(
                    selectedCandidate.status
                  )}`}
                  value={selectedCandidate.status}
                  disabled={updatingStatusId === selectedCandidate.id}
                  onChange={(event) =>
                    handleStatusChange(selectedCandidate, event.target.value)
                  }
                  aria-label={`Update status for ${selectedCandidate.name}`}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="candidate-detail">
                <span>Applying for</span>
                <strong>{selectedCandidate.role || 'Role not specified'}</strong>
              </div>

              <div className="candidate-detail">
                <span>Email address</span>
                <strong>
                  {selectedCandidate.email ? (
                    <a href={`mailto:${selectedCandidate.email}`}>
                      {selectedCandidate.email}
                    </a>
                  ) : (
                    'No email on file'
                  )}
                </strong>
              </div>

              <div className="candidate-detail">
                <span>Phone</span>
                <strong>
                  {selectedCandidate.phone ? (
                    <a href={`tel:${selectedCandidate.phone}`}>
                      {selectedCandidate.phone}
                    </a>
                  ) : (
                    'No phone on file'
                  )}
                </strong>
              </div>

              <div className="candidate-detail">
                <span>Resume</span>

                <strong>
                  {uploadingIds.has(selectedCandidate.id) ? (
                    'Uploading resume…'
                  ) : selectedCandidate.resumeUrl ? (
                    <a
                      href={selectedCandidate.resumeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {selectedCandidate.resumeName || 'Open resume'}
                    </a>
                  ) : (
                    'No resume attached yet'
                  )}
                </strong>
              </div>

              <div className="candidate-detail">
                <span>Notes</span>

                <strong className="candidate-notes">
                  {selectedCandidate.notes || 'No notes added yet.'}
                </strong>
              </div>

              <div className="candidate-detail">
                <span>Added on</span>
                <strong>{formatDate(selectedCandidate.createdMs)}</strong>
              </div>

              {/* ---- quick emails ---- */}
              <div className="candidate-detail">
                <span>Quick email</span>

                {selectedCandidate.email ? (
                  <div className="email-templates">
                    {EMAIL_TEMPLATES.map((template) => (
                      <a
                        key={template.key}
                        className="btn btn--small"
                        href={buildMailto(
                          selectedCandidate,
                          template,
                          actorName
                        )}
                        onClick={() =>
                          logActivity(selectedCandidate.id, {
                            type: 'email',
                            text: `Email drafted: ${template.label}`,
                          })
                        }
                      >
                        {template.label}
                      </a>
                    ))}
                  </div>
                ) : (
                  <strong>No email on file</strong>
                )}
              </div>

              {/* ---- interview feedback ---- */}
              <div className="candidate-detail">
                <span>
                  Interview feedback
                  {selectedCandidate.ratingCount > 0 &&
                    ` · average ${averageRating(selectedCandidate).toFixed(
                      1
                    )} from ${selectedCandidate.ratingCount}`}
                </span>

                <div
                  className="rating-input"
                  role="group"
                  aria-label="Rate this candidate"
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={value <= feedbackRating ? 'is-on' : ''}
                      aria-pressed={feedbackRating === value}
                      aria-label={`${value} star${value === 1 ? '' : 's'}`}
                      onClick={() =>
                        setFeedbackRating(feedbackRating === value ? 0 : value)
                      }
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
              </div>

              {/* ---- history ---- */}
              <div className="candidate-detail">
                <span>History</span>

                {activity.length === 0 ? (
                  <strong className="candidate-notes">
                    Changes and feedback will appear here.
                  </strong>
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
                              <span className="timeline__stars">
                                {stars(item.rating)}{' '}
                              </span>
                            )}
                            {item.text ||
                              (item.type === 'feedback' ? 'Rated' : '')}
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
              </div>
            </div>

            <div className="candidate-modal__actions candidate-modal__actions--split">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => setDeleteTargets([selectedCandidate])}
              >
                Delete candidate
              </button>

              <div className="candidate-modal__actions-group">
                <button
                  type="button"
                  className="btn"
                  onClick={() => openEditModal(selectedCandidate)}
                >
                  Edit
                </button>

                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setSelectedId(null)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================
          DELETE CONFIRMATION DIALOG
      ===================================== */}

      {deleteTargets.length > 0 && (
        <div
          className="candidate-modal-overlay candidate-modal-overlay--top"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              setDeleteTargets([])
            }
          }}
        >
          <div
            className="candidate-modal candidate-modal--small"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="candidate-delete-title"
            aria-describedby="candidate-delete-text"
          >
            <div
              className="candidate-dialog-icon candidate-dialog-icon--danger"
              aria-hidden="true"
            >
              🗑
            </div>

            <h2 id="candidate-delete-title" className="candidate-notice__title">
              {deleteIsMany
                ? `Remove ${deleteTargets.length} candidates?`
                : 'Remove this candidate?'}
            </h2>

            <div className="dialog-person">
              <span className="dialog-person__avatar" aria-hidden="true">
                {deleteIsMany
                  ? deleteTargets.length
                  : getInitials(deleteTargets[0].name)}
              </span>

              <div className="dialog-person__info">
                {deleteIsMany ? (
                  <>
                    <b>
                      {deleteTargets
                        .slice(0, 3)
                        .map((candidate) => candidate.name)
                        .join(', ')}
                      {deleteTargets.length > 3
                        ? ` and ${deleteTargets.length - 3} more`
                        : ''}
                    </b>
                    <span>Selected candidates</span>
                  </>
                ) : (
                  <>
                    <b>{deleteTargets[0].name}</b>
                    <span>
                      {[deleteTargets[0].role, deleteTargets[0].status]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </>
                )}
              </div>
            </div>

            <p id="candidate-delete-text" className="candidate-modal__text">
              {deleteIsMany
                ? 'Their profiles, notes and resumes will be taken off your list.'
                : 'Their profile, notes and resume will be taken off your list.'}{' '}
              Changed your mind? You can undo for a few seconds right after.
            </p>

            <div className="candidate-modal__actions">
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
          </div>
        </div>
      )}

      {/* =====================================
          SUCCESS / IMPORT / ERROR DIALOG
      ===================================== */}

      {notice && (
        <div
          className="candidate-modal-overlay candidate-modal-overlay--notice"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNotice(null)
          }}
        >
          <div
            className="candidate-modal candidate-modal--small"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="candidate-notice-title"
          >
            {notice.type === 'added' ? (
              <>
                <div
                  className="candidate-dialog-icon candidate-dialog-icon--success"
                  aria-hidden="true"
                >
                  ✓
                </div>

                <h2
                  id="candidate-notice-title"
                  className="candidate-notice__title"
                >
                  Candidate added
                </h2>

                <p className="candidate-modal__text">
                  <strong>{notice.name}</strong> is now in your pipeline and
                  ready for screening.
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
                      {notice.resumeName
                        ? `${notice.resumeName} · uploading`
                        : 'Not attached yet'}
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
            ) : notice.type === 'import' ? (
              <>
                <div
                  className={`candidate-dialog-icon ${
                    notice.added > 0
                      ? 'candidate-dialog-icon--success'
                      : 'candidate-dialog-icon--danger'
                  }`}
                  aria-hidden="true"
                >
                  {notice.added > 0 ? '✓' : '!'}
                </div>

                <h2
                  id="candidate-notice-title"
                  className="candidate-notice__title"
                >
                  {notice.added > 0 ? 'Import finished' : 'Nothing imported'}
                </h2>

                <p className="candidate-modal__text">
                  {notice.added > 0
                    ? `${notice.added} new candidate${
                        notice.added === 1 ? ' was' : 's were'
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

                <div className="candidate-modal__actions">
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
            ) : (
              <>
                <div
                  className="candidate-dialog-icon candidate-dialog-icon--danger"
                  aria-hidden="true"
                >
                  !
                </div>

                <h2
                  id="candidate-notice-title"
                  className="candidate-notice__title"
                >
                  {notice.title}
                </h2>

                <p className="candidate-modal__text">{notice.message}</p>

                <div className="candidate-modal__actions">
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
          </div>
        </div>
      )}

      {/* =====================================
          TOASTS
      ===================================== */}

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
              ×
            </button>
          </div>
        ))}
      </div>

      <footer className="footer">
        Sift assists interviewers. Hiring decisions stay with you.
      </footer>
    </div>
  )
}