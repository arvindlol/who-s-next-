export const DAY_MS = 24 * 60 * 60 * 1000

/** Milliseconds from a Firestore Timestamp, a Date, a number or an ISO string (0 when missing). */
export function timestampMs(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function formatDate(value, fallback = '—') {
  const ms = timestampMs(value)
  if (!ms) return fallback
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(value, fallback = '—') {
  const ms = timestampMs(value)
  if (!ms) return fallback
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

export function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function daysSince(ms, now = Date.now()) {
  return Math.max(0, Math.floor((now - ms) / DAY_MS))
}

export function scoreTone(score) {
  if (score >= 75) return 'high'
  if (score >= 60) return 'medium'
  return 'low'
}
