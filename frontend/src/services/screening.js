import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { api } from './api.js'
import { timestampMs } from '../utils/format.js'

// A run that has not finished after this long is treated as abandoned (function timeout is 30 min).
const STALE_RUN_MS = 35 * 60 * 1000

export const SCREENING_STAGES = {
  preparing: { label: 'Preparing the job and candidate files', percent: 10 },
  reading: { label: 'Reading the PDF documents', percent: 30 },
  analyzing: { label: 'Gemini is comparing and ranking the candidates', percent: 60 },
  saving: { label: 'Validating and saving the report', percent: 92 },
  completed: { label: 'Screening complete', percent: 100 },
}

function toScreening(item) {
  const data = item.data()
  return {
    id: item.id,
    jobId: data.jobId || '',
    jobTitle: data.jobTitle || 'Untitled job',
    createdAt: timestampMs(data.createdAt),
    status: data.status || 'completed',
    stage: data.stage || '',
    candidateIds: data.candidateIds || [],
    results: Array.isArray(data.results) ? data.results : [],
    screeningSummary: data.screeningSummary || {},
  }
}

/** Completed screenings plus runs in progress (abandoned runs are hidden), newest first. */
export function subscribeToScreenings(uid, onChange, onError) {
  return onSnapshot(
    query(collection(db, 'screeningReports'), where('ownerId', '==', uid)),
    snapshot => {
      const now = Date.now()
      onChange(snapshot.docs
        .map(toScreening)
        .filter(screening => screening.status === 'completed'
          || (screening.status === 'running' && now - (screening.createdAt || now) < STALE_RUN_MS))
        .sort((a, b) => (b.createdAt || now) - (a.createdAt || now)))
    },
    onError,
  )
}

/** Creates the report ID up front so the UI can follow the run's progress on that document. */
export function newScreeningId() {
  return doc(collection(db, 'screeningReports')).id
}

export function runScreening({ reportId, jobId, candidateIds }) {
  return api.runScreening({ reportId, jobId, candidateIds })
}
