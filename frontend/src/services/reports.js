import {
  collection,
  doc,
  writeBatch,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase.js'

export const DECISIONS = {
  move_to_offer: { label: 'Move to offer', tone: 'good' },
  another_interview: { label: 'Another interview', tone: 'info' },
  do_not_progress: { label: 'Do not progress', tone: 'bad' },
}

export const AI_SUGGESTIONS = {
  move_to_offer: 'Move to offer',
  move_to_next_stage: 'Move to next stage',
  another_interview: 'Another interview',
  do_not_progress: 'Do not progress',
}

const reportsRef = () => collection(db, 'reports')

const toMillis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : 0)

/** Live list of all reports owned by this user (archived + active). Sorted newest first. */
export function subscribeToReports(userId, onData, onError) {
  const q = query(reportsRef(), where('userId', '==', userId))
  return onSnapshot(
    q,
    snapshot => {
      const reports = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      onData(reports)
    },
    onError,
  )
}

/** Live single report. Calls onData(null) when it does not exist or is not yours. */
export function subscribeToReport(userId, reportId, onData, onError) {
  return onSnapshot(
    doc(db, 'reports', reportId),
    snapshot => {
      if (!snapshot.exists()) return onData(null)
      const data = { id: snapshot.id, ...snapshot.data() }
      onData(data.userId === userId ? data : null)
    },
    onError,
  )
}

// A hiring decision also moves the candidate's status, so the Candidates
// page and its dashboard update on their own.
export const DECISION_TO_STATUS = {
  move_to_offer: 'Hired',
  another_interview: 'Interview Pending',
  do_not_progress: 'Rejected',
}

export function saveReportDecision(report, userId, decision, reason) {
  if (!DECISIONS[decision]) throw new Error('Choose a decision first.')
  const batch = writeBatch(db)
  batch.update(doc(db, 'reports', report.id), {
    decision,
    decisionReason: (reason || '').trim(),
    decidedBy: userId,
    decidedAt: serverTimestamp(),
  })
  if (report.candidateId) {
    batch.update(doc(db, 'candidates', report.candidateId), {
      status: DECISION_TO_STATUS[decision],
      updatedAt: serverTimestamp(),
    })
  }
  return batch.commit()
}

export function setReportArchived(reportId, archived) {
  return updateDoc(doc(db, 'reports', reportId), {
    archived,
    archivedAt: archived ? serverTimestamp() : null,
  })
}

export function markReportViewed(reportId) {
  return updateDoc(doc(db, 'reports', reportId), { viewedAt: serverTimestamp() })
}