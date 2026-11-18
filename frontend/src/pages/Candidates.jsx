import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppLayout from '../components/AppLayout.jsx'
import { useAuth } from '../auth.jsx'
import { useToasts } from '../hooks/useToasts.js'
import { CANDIDATE_STAGES } from '../constants/statuses.js'
import {
  createCandidate,
  importCandidates,
  logActivity,
  newCandidateId,
  purgeCandidates,
  restoreCandidates,
  saveFeedback,
  setCandidateStage,
  setStageForMany,
  softDeleteCandidates,
  subscribeToCandidates,
  updateCandidate,
  uploadResume,
} from '../services/candidates.js'
import { firebaseErrorMessage } from '../services/errorMessages.js'
import { subscribeToJobs } from '../services/jobs.js'
import { averageRating, isStale, parseSkills, validateResumeFile } from '../utils/candidateModel.js'
import { downloadCsv, parseCsv } from '../utils/csv.js'
import { EMAIL_PATTERN, normalizeEmail, normalizePhone, phoneKey } from '../utils/email.js'
import { plural } from '../utils/format.js'
import CandidateFormModal from './candidates/CandidateFormModal.jsx'
import CandidateProfileModal from './candidates/CandidateProfileModal.jsx'
import { DeleteCandidatesDialog, NoticeDialog } from './candidates/CandidateDialogs.jsx'
import { CandidateBoard, CandidateTable } from './candidates/CandidateViews.jsx'
import { ToastStack } from './candidates/parts.jsx'
import './Candidates.css'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'status', label: 'By stage' },
  { value: 'rating', label: 'Top rated' },
]

const MAX_IMPORT_SIZE = 5 * 1024 * 1024
const MAX_IMPORT_ROWS = 1000
const PAGE_SIZE = 50
const UNDO_WINDOW_MS = 8000
const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

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

/** Only internal screening URLs are accepted as a return target (no open redirects). */
function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/screening') && !value.startsWith('//') ? value : ''
}

export default function Candidates() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toasts, pushToast, dismissToast } = useToasts()
  const senderName = user?.name || user?.email || 'The hiring team'

  const importInputRef = useRef(null)
  const searchRef = useRef(null)
  const highlightTimer = useRef(null)
  // candidateId -> timer: the server deletion runs when the undo window ends.
  const pendingPurges = useRef(new Map())

  const [candidates, setCandidates] = useState([])
  const [jobTitles, setJobTitles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatingStageId, setUpdatingStageId] = useState(null)
  const [uploadingIds, setUploadingIds] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteTargets, setDeleteTargets] = useState([])
  const [notice, setNotice] = useState(null)
  const [highlightId, setHighlightId] = useState(null)

  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput)
  const [filterStatus, setFilterStatus] = useState('All')
  const [sortBy, setSortBy] = useState('newest')
  const [view, setView] = useState('list')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragOverStage, setDragOverStage] = useState(null)

  const [form, setForm] = useState(null) // null | { editingId: string | null }
  const [selectedId, setSelectedId] = useState(null)
  const [returnTo, setReturnTo] = useState('')

  const isBoard = view === 'board'

  const flashRow = useCallback(id => {
    setHighlightId(id)
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2000)
  }, [])

  // ---------- data ----------
  useEffect(() => {
    if (!user?.uid) return undefined
    setLoading(true)
    return subscribeToCandidates(
      user.uid,
      next => {
        setCandidates(next)
        setLoading(false)
      },
      error => {
        console.error('Failed to load candidates:', error)
        setLoading(false)
        pushToast('error', firebaseErrorMessage(error, 'Your candidates could not be loaded.'))
      },
    )
  }, [user?.uid, pushToast])

  useEffect(() => {
    if (!user?.uid) return undefined
    return subscribeToJobs(
      user.uid,
      jobs => setJobTitles([...new Set(jobs.map(job => String(job.title || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))),
      error => console.warn('Job suggestions unavailable:', error?.code || error),
    )
  }, [user?.uid])

  // Finish pending deletions if the page is left during the undo window.
  useEffect(() => {
    const pending = pendingPurges.current
    return () => {
      clearTimeout(highlightTimer.current)
      if (pending.size) {
        pending.forEach(timer => clearTimeout(timer))
        purgeCandidates([...pending.keys()])
        pending.clear()
      }
    }
  }, [])

  // ---------- links from other pages: ?new=true&returnTo=…, ?candidateId=… ----------
  useEffect(() => {
    const wantsNew = searchParams.get('new') === 'true'
    const candidateId = searchParams.get('candidateId')
    if (!wantsNew && !candidateId) return

    if (wantsNew) {
      setReturnTo(safeReturnTo(searchParams.get('returnTo')))
      setForm({ editingId: null })
    }
    if (candidateId) setSelectedId(candidateId)

    const next = new URLSearchParams(searchParams)
    ;['new', 'returnTo', 'candidateId'].forEach(key => next.delete(key))
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // ---------- derived ----------
  const selectedCandidate = useMemo(() => candidates.find(item => item.id === selectedId) || null, [candidates, selectedId])
  const editingCandidate = useMemo(
    () => (form?.editingId ? candidates.find(item => item.id === form.editingId) || null : null),
    [candidates, form],
  )

  const statusCounts = useMemo(() => {
    const counts = {}
    candidates.forEach(candidate => { counts[candidate.status] = (counts[candidate.status] || 0) + 1 })
    return counts
  }, [candidates])

  const followUpCount = useMemo(() => candidates.filter(candidate => isStale(candidate)).length, [candidates])

  const filteredCandidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = candidates.filter(candidate => {
      if (filterStatus === 'Follow-up') {
        if (!isStale(candidate)) return false
      } else if (filterStatus !== 'All' && candidate.status !== filterStatus) {
        return false
      }
      if (!term) return true
      return [candidate.name, candidate.email, candidate.phone, candidate.role, candidate.status, candidate.notes, ...candidate.skills]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })

    list.sort((a, b) => {
      if (sortBy === 'oldest') return a.createdMs - b.createdMs
      if (sortBy === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      if (sortBy === 'status') return CANDIDATE_STAGES.indexOf(a.status) - CANDIDATE_STAGES.indexOf(b.status) || b.createdMs - a.createdMs
      if (sortBy === 'rating') return averageRating(b) - averageRating(a) || b.createdMs - a.createdMs
      return b.createdMs - a.createdMs
    })
    return list
  }, [candidates, search, filterStatus, sortBy])

  const shownCandidates = filteredCandidates.slice(0, visibleCount)

  const boardGroups = useMemo(() => {
    const groups = Object.fromEntries(CANDIDATE_STAGES.map(stage => [stage, []]))
    filteredCandidates.forEach(candidate => {
      // Unknown stored stages are shown in the first column rather than disappearing.
      ;(groups[candidate.status] || groups.Screening).push(candidate)
    })
    return groups
  }, [filteredCandidates])

  const selectedList = useMemo(() => candidates.filter(candidate => selectedIds.has(candidate.id)), [candidates, selectedIds])

  const chips = useMemo(() => [
    { key: 'All', label: 'All', count: candidates.length },
    ...(followUpCount > 0 || filterStatus === 'Follow-up' ? [{ key: 'Follow-up', label: 'Needs follow-up', count: followUpCount }] : []),
    ...CANDIDATE_STAGES
      .filter(stage => statusCounts[stage] || stage === filterStatus)
      .map(stage => ({ key: stage, label: stage, count: statusCounts[stage] || 0 })),
  ], [statusCounts, candidates.length, followUpCount, filterStatus])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    setSelectedIds(new Set())
  }, [search, filterStatus, sortBy, view])

  useEffect(() => {
    setSelectedIds(previous => {
      if (previous.size === 0) return previous
      const existing = new Set(candidates.map(candidate => candidate.id))
      const next = new Set([...previous].filter(id => existing.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [candidates])

  // ---------- keyboard shortcuts + dialog focus ----------
  const dialogOpen = Boolean(form) || Boolean(selectedCandidate) || deleteTargets.length > 0 || Boolean(notice)

  const openAddForm = useCallback(() => {
    setReturnTo('')
    setForm({ editingId: null })
  }, [])

  const closeForm = useCallback(() => {
    if (saving) return
    setForm(null)
    setReturnTo('')
  }, [saving])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (notice) setNotice(null)
        else if (deleteTargets.length > 0) {
          if (!deleting) setDeleteTargets([])
        } else if (form) closeForm()
        else if (selectedId) setSelectedId(null)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || dialogOpen) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openAddForm()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [notice, deleteTargets, deleting, form, selectedId, dialogOpen, closeForm, openAddForm])

  useEffect(() => {
    if (!dialogOpen) return undefined
    function onTab(event) {
      if (event.key !== 'Tab') return
      const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]')
      const top = dialogs[dialogs.length - 1]
      if (!top) return
      const focusable = [...top.querySelectorAll(FOCUSABLE)].filter(element => element.offsetParent !== null)
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

  // ---------- add / edit ----------
  const validateForm = useCallback((values, file) => {
    if (!user?.uid) return { error: 'Your session has expired. Please sign in to continue.' }

    const name = values.name.trim()
    const role = values.role.trim()
    const email = normalizeEmail(values.email)
    const phone = normalizePhone(values.phone)

    if (!name || !role || !email) return { error: 'Please add a name, job role and email to continue.' }
    if (!EMAIL_PATTERN.test(email)) return { error: 'That email doesn’t look complete. Please include the full address, e.g. name@company.com.' }
    if (phone) {
      const digits = phone.replace(/\D/g, '').length
      if (digits < 7 || digits > 15) return { error: 'That phone number doesn’t look right. Use 7 to 15 digits, or leave it empty.' }
    }

    const others = candidates.filter(candidate => candidate.id !== form?.editingId)
    const duplicateEmail = others.find(candidate => candidate.email.toLowerCase() === email)
    if (duplicateEmail) return { error: `${duplicateEmail.name} is already on your list with this email address.` }
    const duplicatePhone = phone && others.find(candidate => candidate.phone && phoneKey(candidate.phone) === phoneKey(phone))
    if (duplicatePhone) return { error: `${duplicatePhone.name} is already on your list with this phone number.` }

    const fileError = validateResumeFile(file)
    if (fileError) return { error: fileError }

    return { values: { name, role, email, phone, skills: parseSkills(values.skills), notes: values.notes.trim() } }
  }, [user?.uid, candidates, form?.editingId])

  async function uploadResumeFor(candidateId, file, previousPath = '') {
    setUploadingIds(previous => new Set(previous).add(candidateId))
    try {
      await uploadResume(user, candidateId, file, previousPath)
      pushToast('success', previousPath ? 'Resume replaced' : 'Resume attached to the profile')
      return true
    } catch (error) {
      console.error('Resume upload failed:', error)
      pushToast('error', `The candidate was saved, but the resume couldn’t be uploaded. ${firebaseErrorMessage(error, '')}`.trim())
      return false
    } finally {
      setUploadingIds(previous => {
        const next = new Set(previous)
        next.delete(candidateId)
        return next
      })
    }
  }

  async function handleSubmit(values, file, keepOpen) {
    setSaving(true)
    try {
      if (editingCandidate) {
        await updateCandidate(user, editingCandidate.id, values)
        setForm(null)
        flashRow(editingCandidate.id)
        pushToast('success', `${values.name} updated`)
        if (file) uploadResumeFor(editingCandidate.id, file, editingCandidate.resumePath)
        return true
      }

      const candidateId = newCandidateId()
      await createCandidate(user, candidateId, values)
      flashRow(candidateId)

      if (returnTo) {
        // Coming from screening: finish the upload so the candidate is selectable there.
        if (file) await uploadResumeFor(candidateId, file)
        setForm(null)
        navigate(returnTo)
        return true
      }

      if (file) uploadResumeFor(candidateId, file)
      if (keepOpen) {
        pushToast('success', `${values.name} added. Ready for the next one.`)
      } else {
        setForm(null)
        setNotice({ type: 'added', candidateId, name: values.name, role: values.role, email: values.email, resumeName: file?.name || '' })
      }
      return true
    } catch (error) {
      console.error('Saving candidate failed:', error)
      pushToast('error', firebaseErrorMessage(error, 'The candidate could not be saved. Please try again.'))
      return false
    } finally {
      setSaving(false)
    }
  }

  // ---------- stages ----------
  async function handleStageChange(candidate, stage) {
    if (!user?.uid || !stage || candidate.status === stage) return
    const previous = candidate.status
    const setStage = (value, extra = {}) => setCandidates(list => list.map(item => (item.id === candidate.id ? { ...item, status: value, ...extra } : item)))

    setUpdatingStageId(candidate.id)
    setStage(stage, { updatedMs: Date.now() })
    try {
      await setCandidateStage(user, candidate, stage)
      pushToast('success', `${candidate.name} moved to ${stage}`, { duration: 2500 })
    } catch (error) {
      console.error('Stage change failed:', error)
      setStage(previous)
      pushToast('error', `Stage wasn’t changed. ${firebaseErrorMessage(error, '')}`.trim())
    } finally {
      setUpdatingStageId(null)
    }
  }

  async function handleBulkStage(stage) {
    if (!stage || selectedList.length === 0) return
    const targets = selectedList.filter(candidate => candidate.status !== stage)
    if (targets.length === 0) {
      pushToast('success', `Everyone selected is already at ${stage}`, { duration: 2500 })
      return
    }
    setBulkBusy(true)
    try {
      await setStageForMany(user, targets, stage)
      setSelectedIds(new Set())
      pushToast('success', `${plural(targets.length, 'candidate')} moved to ${stage}`)
    } catch (error) {
      console.error('Bulk stage change failed:', error)
      pushToast('error', `Stages weren’t changed. ${firebaseErrorMessage(error, '')}`.trim())
    } finally {
      setBulkBusy(false)
    }
  }

  // ---------- delete (soft delete, undo window, then full server deletion) ----------
  async function handleDeleteConfirmed() {
    const list = deleteTargets
    if (list.length === 0) return
    setDeleting(true)
    try {
      await softDeleteCandidates(list)
      const removedIds = new Set(list.map(candidate => candidate.id))
      setDeleteTargets([])
      if (removedIds.has(selectedId)) setSelectedId(null)

      list.forEach(candidate => {
        const timer = setTimeout(() => {
          pendingPurges.current.delete(candidate.id)
          purgeCandidates([candidate.id])
        }, UNDO_WINDOW_MS + 500)
        pendingPurges.current.set(candidate.id, timer)
      })

      pushToast('success', `${list.length === 1 ? list[0].name : `${list.length} candidates`} deleted`, {
        duration: UNDO_WINDOW_MS,
        actionLabel: 'Undo',
        onAction: () => handleUndoDelete(list),
      })
    } catch (error) {
      console.error('Delete failed:', error)
      setDeleteTargets([])
      setNotice({
        type: 'error',
        title: 'Couldn’t delete',
        message: `${list.length === 1 ? `${list[0].name} is` : 'These candidates are'} still on your list. ${firebaseErrorMessage(error, '')}`.trim(),
      })
    } finally {
      setDeleting(false)
    }
  }

  async function handleUndoDelete(list) {
    list.forEach(candidate => {
      clearTimeout(pendingPurges.current.get(candidate.id))
      pendingPurges.current.delete(candidate.id)
    })
    try {
      await restoreCandidates(list)
      if (list.length === 1) flashRow(list[0].id)
      pushToast('success', list.length === 1 ? `${list[0].name} is back on your list` : `${list.length} candidates are back on your list`)
    } catch (error) {
      console.error('Restore failed:', error)
      pushToast('error', `Couldn’t restore them. ${firebaseErrorMessage(error, '')}`.trim())
    }
  }

  // ---------- feedback ----------
  async function handleSaveFeedback(candidate, rating, text) {
    if (!rating) {
      pushToast('error', 'Choose a rating from 1 to 5 stars first.')
      return false
    }
    try {
      await saveFeedback(user, candidate.id, rating, text)
      pushToast('success', 'Feedback saved', { duration: 2500 })
      return true
    } catch (error) {
      console.error('Feedback failed:', error)
      pushToast('error', `Feedback wasn’t saved. ${firebaseErrorMessage(error, '')}`.trim())
      return false
    }
  }

  // ---------- CSV ----------
  function exportCandidates(list) {
    if (list.length === 0) return
    downloadCsv(`candidates-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Name', 'Email', 'Phone', 'Role', 'Skills', 'Stage', 'Rating', 'Notes', 'Added on'],
      ...list.map(candidate => [
        candidate.name,
        candidate.email,
        candidate.phone,
        candidate.role,
        candidate.skills.join(', '),
        candidate.status,
        averageRating(candidate) ? averageRating(candidate).toFixed(1) : '',
        candidate.notes,
        new Date(candidate.createdMs).toLocaleDateString(),
      ]),
    ])
    pushToast('success', `Exported ${plural(list.length, 'candidate')}`, { duration: 2500 })
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !user?.uid) return
    if (!/\.csv$/i.test(file.name)) return pushToast('error', 'Please choose a .csv file.')
    if (file.size > MAX_IMPORT_SIZE) return pushToast('error', 'That file is too large. Please keep it under 5 MB.')

    setImporting(true)
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) throw new Error('That file has no candidate rows.')

      const headers = rows[0].map(header => header.trim().toLowerCase())
      const column = (...names) => headers.findIndex(header => names.includes(header))
      const cell = (row, index, max) => (index === -1 ? '' : (row[index] || '').trim().slice(0, max))

      const nameIndex = column('name', 'full name')
      const emailIndex = column('email', 'email address')
      const roleIndex = column('role', 'job role', 'applying for', 'position')
      const phoneIndex = column('phone', 'mobile', 'phone number')
      const skillsIndex = column('skills', 'key skills')
      const notesIndex = column('notes', 'note', 'additional information')
      if (nameIndex === -1 || emailIndex === -1) throw new Error('The file needs at least a "Name" and an "Email" column.')

      const known = new Set(candidates.map(candidate => candidate.email.toLowerCase()))
      const toAdd = []
      let skippedInvalid = 0
      let skippedDuplicate = 0

      rows.slice(1).forEach(row => {
        if (row.every(value => !value.trim())) return
        const name = cell(row, nameIndex, 100)
        const email = normalizeEmail(row[emailIndex] || '')
        if (!name || !EMAIL_PATTERN.test(email)) {
          skippedInvalid += 1
          return
        }
        if (known.has(email)) {
          skippedDuplicate += 1
          return
        }
        known.add(email)
        toAdd.push({
          name,
          email,
          role: cell(row, roleIndex, 150) || 'Not specified',
          phone: normalizePhone(cell(row, phoneIndex, 30)),
          skills: parseSkills(cell(row, skillsIndex, 1000)),
          notes: cell(row, notesIndex, 3000),
        })
      })

      if (toAdd.length > MAX_IMPORT_ROWS) throw new Error(`That file has ${toAdd.length} new candidates. Please import up to ${MAX_IMPORT_ROWS} at a time.`)

      await importCandidates(user, toAdd)
      setNotice({ type: 'import', added: toAdd.length, skippedInvalid, skippedDuplicate })
    } catch (error) {
      console.error('Import failed:', error)
      pushToast('error', error?.code ? firebaseErrorMessage(error) : error.message)
    } finally {
      setImporting(false)
    }
  }

  function handleBoardDrop(event, stage) {
    event.preventDefault()
    setDragOverStage(null)
    const candidate = candidates.find(item => item.id === event.dataTransfer.getData('text/plain'))
    if (candidate) handleStageChange(candidate, stage)
  }

  const toggleSelected = id => setSelectedIds(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const toggleSelectAll = () => setSelectedIds(previous => {
    const next = new Set(previous)
    const all = shownCandidates.every(candidate => previous.has(candidate.id))
    shownCandidates.forEach(candidate => (all ? next.delete(candidate.id) : next.add(candidate.id)))
    return next
  })

  const hasFilters = Boolean(search) || filterStatus !== 'All'

  // ---------- UI ----------
  return (
    <AppLayout mainClassName="page jobs-page">
      <section className="jobs-page__head">
        <div>
          <span className="eyebrow">Your workspace</span>
          <h1>Candidates</h1>
          <p>Manage candidates, review resumes, and track each one through your hiring process.</p>
        </div>
        <div className="cand-head__actions">
          <button type="button" className="btn" onClick={() => importInputRef.current?.click()} disabled={importing} title="Add many candidates from a CSV file (Name, Email, Role, Phone, Skills, Notes)">
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          <button type="button" className="btn" onClick={() => exportCandidates(filteredCandidates)} disabled={filteredCandidates.length === 0} title="Download the candidates shown as a CSV file">
            Export CSV
          </button>
          <button type="button" className="btn btn--primary jobs-page__add" onClick={openAddForm}>
            <span aria-hidden="true">＋</span> Add candidate
          </button>
          <input ref={importInputRef} type="file" accept=".csv,text/csv" onChange={handleImportFile} aria-label="Import candidates from a CSV file" className="visually-hidden" />
        </div>
      </section>

      <section className="jobs-table-wrap glass glass--lg cand-panel">
        <div className="cand-toolbar">
          <div className="candidate-search">
            <input
              ref={searchRef}
              type="search"
              placeholder="Search name, email, role, skills or notes"
              aria-label="Search candidates"
              value={searchInput}
              onChange={event => setSearchInput(event.target.value)}
            />
            {!searchInput && <kbd aria-hidden="true">/</kbd>}
          </div>
          <select className="candidate-sort" value={sortBy} onChange={event => setSortBy(event.target.value)} aria-label="Sort candidates">
            {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <div className="candidate-view-toggle" role="group" aria-label="Choose layout">
            {['list', 'board'].map(mode => (
              <button key={mode} type="button" className={view === mode ? 'is-active' : ''} aria-pressed={view === mode} onClick={() => setView(mode)}>
                {mode === 'list' ? 'List' : 'Board'}
              </button>
            ))}
          </div>
        </div>

        {!isBoard && (
          <div className="candidate-chips" role="group" aria-label="Filter by stage">
            {chips.map(chip => (
              <button
                key={chip.key}
                type="button"
                className={`candidate-chip ${filterStatus === chip.key ? 'candidate-chip--active' : ''}`}
                aria-pressed={filterStatus === chip.key}
                onClick={() => setFilterStatus(chip.key)}
              >
                {chip.label}<span className="candidate-chip__count">{chip.count}</span>
              </button>
            ))}
          </div>
        )}

        {!isBoard && selectedList.length > 0 && (
          <div className="bulk-bar" role="region" aria-label="Bulk actions">
            <b>{selectedList.length} selected</b>
            <select className="candidate-sort bulk-bar__select" value="" onChange={event => handleBulkStage(event.target.value)} disabled={bulkBusy} aria-label="Move selected candidates to a stage">
              <option value="" disabled>{bulkBusy ? 'Updating…' : 'Move to stage…'}</option>
              {CANDIDATE_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}
            </select>
            <button type="button" className="btn btn--small" onClick={() => exportCandidates(selectedList)}>Export</button>
            <button type="button" className="btn btn--small btn--danger" onClick={() => setDeleteTargets(selectedList)} disabled={bulkBusy}>Delete</button>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setSelectedIds(new Set())}>Clear</button>
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
                <button type="button" className="btn" onClick={() => { setSearchInput(''); setFilterStatus('All') }}>Clear filters</button>
              </>
            ) : (
              <>
                <h2>No candidates yet</h2>
                <p>Add your first candidate, or import a CSV to get started.</p>
                <button type="button" className="btn btn--primary" onClick={openAddForm}>Add your first candidate</button>
              </>
            )}
          </div>
        ) : isBoard ? (
          <CandidateBoard
            groups={boardGroups}
            dragOverStage={dragOverStage}
            highlightId={highlightId}
            onDragOverStage={setDragOverStage}
            onDrop={handleBoardDrop}
            onOpen={setSelectedId}
          />
        ) : (
          <CandidateTable
            candidates={shownCandidates}
            totalFiltered={filteredCandidates.length}
            selectedIds={selectedIds}
            highlightId={highlightId}
            uploadingIds={uploadingIds}
            updatingStageId={updatingStageId}
            onToggle={toggleSelected}
            onToggleAll={toggleSelectAll}
            onOpen={setSelectedId}
            onEdit={candidate => {
              setSelectedId(null)
              setForm({ editingId: candidate.id })
            }}
            onDelete={setDeleteTargets}
            onStageChange={handleStageChange}
            onShowMore={() => setVisibleCount(count => count + PAGE_SIZE)}
          />
        )}
      </section>

      {!loading && candidates.length > 0 && (
        <p className="jobs-page__count">
          {plural(filteredCandidates.length, 'candidate')}{hasFilters ? ` of ${candidates.length}` : ''}
        </p>
      )}

      {form && (
        <CandidateFormModal
          key={form.editingId || 'new'}
          editing={editingCandidate}
          jobTitles={jobTitles}
          saving={saving}
          validate={validateForm}
          onSubmit={handleSubmit}
          onClose={closeForm}
        />
      )}

      {selectedCandidate && !form && (
        <CandidateProfileModal
          candidate={selectedCandidate}
          stageBusy={updatingStageId === selectedCandidate.id}
          uploading={uploadingIds.has(selectedCandidate.id)}
          senderName={senderName}
          onStageChange={handleStageChange}
          onSaveFeedback={handleSaveFeedback}
          onEmailDrafted={(candidate, template) => logActivity(user, candidate.id, 'email', `Email drafted: ${template.label}`)}
          onEdit={candidate => {
            setSelectedId(null)
            setForm({ editingId: candidate.id })
          }}
          onDelete={setDeleteTargets}
          onClose={() => setSelectedId(null)}
        />
      )}

      {deleteTargets.length > 0 && (
        <DeleteCandidatesDialog
          targets={deleteTargets}
          deleting={deleting}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteTargets([])}
        />
      )}

      {notice && (
        <NoticeDialog
          notice={notice}
          onClose={() => setNotice(null)}
          onViewProfile={candidateId => {
            setNotice(null)
            setSelectedId(candidateId)
          }}
          onAddAnother={() => {
            setNotice(null)
            openAddForm()
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </AppLayout>
  )
}
