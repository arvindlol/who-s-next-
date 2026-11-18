import { CLOSED_STAGES, normalizeStage } from '../constants/statuses.js'
import { DAY_MS, timestampMs } from './format.js'

export const MAX_RESUME_BYTES = 10 * 1024 * 1024
export const FOLLOW_UP_MS = 7 * DAY_MS

/** Storage object path from a plain path or a Firebase download URL ('' when unknown). */
export function storagePathFromValue(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const reference = value.trim()
  if (!/^https?:\/\//i.test(reference)) return reference.replace(/^\/+/, '')
  try {
    const encoded = new URL(reference).pathname.split('/o/')[1]
    return encoded ? decodeURIComponent(encoded) : ''
  } catch {
    return ''
  }
}

/** Display name of an uploaded file without the "{candidateId}-{timestamp}-" prefix. */
export function displayFileName(path, candidateId = '') {
  let name = String(path || '').split('/').pop() || ''
  if (candidateId && name.startsWith(`${candidateId}-`)) name = name.slice(candidateId.length + 1)
  return name.replace(/^\d{10,}-/, '')
}

/** Skills from free text: comma, "·", semicolon or new line separated; de-duplicated. */
export function parseSkills(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,·;\n]/)
  const seen = new Set()
  const skills = []
  for (const item of list) {
    const skill = String(item || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const key = skill.toLowerCase()
    if (!skill || seen.has(key)) continue
    seen.add(key)
    skills.push(skill)
    if (skills.length >= 30) break
  }
  return skills
}

/**
 * One shape for every candidate document, whichever version of the app created it.
 * Older documents stored the resume as `resume` (download URL) and skills as a string.
 */
export function normalizeCandidate(id, data = {}) {
  const resumeUrl = data.resumeUrl || (/^https?:\/\//i.test(data.resume || '') ? data.resume : '')
  const resumePath = storagePathFromValue(data.resumePath) || storagePathFromValue(data.resume) || storagePathFromValue(resumeUrl)
  const createdMs = timestampMs(data.createdAt) || Date.now()

  return {
    id,
    name: data.name || '',
    role: data.role || '',
    email: data.email || '',
    phone: data.phone || '',
    status: normalizeStage(data.status),
    skills: parseSkills(data.skills),
    notes: data.additionalinformation || data.notes || '',
    resumeUrl,
    resumePath,
    resumeName: data.resumeName || (resumePath ? displayFileName(resumePath, id) : ''),
    ratingSum: Number(data.ratingSum) || 0,
    ratingCount: Number(data.ratingCount) || 0,
    createdMs,
    updatedMs: timestampMs(data.updatedAt) || createdMs,
    deleted: Boolean(data.deletedAt),
  }
}

/** Fields written for a new candidate (matches the Firestore rules allowlist). */
export function newCandidateFields(values) {
  return {
    name: values.name,
    role: values.role,
    email: values.email,
    phone: values.phone || '',
    skills: parseSkills(values.skills),
    status: 'Screening',
    additionalinformation: values.notes || '',
    resumeUrl: '',
    resumeName: '',
    resumePath: '',
    ratingSum: 0,
    ratingCount: 0,
  }
}

export function safeFileName(name) {
  return String(name || 'resume.pdf')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(-120)
}

/** resumes/{uid}/{candidateId}-{timestamp}-{file}.pdf — the prefix is what the backend and rules expect. */
export function resumeStoragePath(uid, candidateId, fileName, now = Date.now()) {
  return `resumes/${uid}/${candidateId}-${now}-${safeFileName(fileName)}`
}

/** '' when the file is an acceptable resume, otherwise a user-facing reason. */
export function validateResumeFile(file) {
  if (!file) return ''
  const isPdf = /\.pdf$/i.test(file.name || '') && (!file.type || file.type === 'application/pdf')
  if (!isPdf) return 'Please upload the resume as a PDF. Screening reads PDF files only.'
  if (file.size > MAX_RESUME_BYTES) return 'That file is too large. Please upload a resume under 10 MB.'
  if (file.size === 0) return 'That file is empty.'
  return ''
}

export function averageRating(candidate) {
  return candidate.ratingCount > 0 ? candidate.ratingSum / candidate.ratingCount : 0
}

export function isStale(candidate, now = Date.now()) {
  return !CLOSED_STAGES.includes(candidate.status) && now - candidate.updatedMs > FOLLOW_UP_MS
}
