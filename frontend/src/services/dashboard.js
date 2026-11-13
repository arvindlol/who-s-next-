import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { isInterviewPending } from '../constants/statuses.js'

/**
 * Workspace numbers for the Overview page:
 *  - jobDescriptions: ready, not closed jobs
 *  - pendingInterviews: interviews without a hiring decision yet
 *  - screeningReports: completed screenings
 */
export function subscribeToDashboardStats(userId, onChange, onReady, onError) {
  const stats = { jobDescriptions: 0, pendingInterviews: 0, screeningReports: 0 }
  const pending = new Set(Object.keys(stats))

  const watch = (key, collectionName, count) => onSnapshot(
    query(collection(db, collectionName), where('ownerId', '==', userId)),
    snapshot => {
      stats[key] = snapshot.docs.map(item => item.data()).filter(count).length
      pending.delete(key)
      onChange({ ...stats })
      if (pending.size === 0) onReady()
    },
    error => {
      pending.delete(key)
      onError(error)
      if (pending.size === 0) onReady()
    },
  )

  const unsubscribers = [
    watch('jobDescriptions', 'jobs', job => job.status === 'ready' && !job.closedAt),
    watch('pendingInterviews', 'interviews', interview => isInterviewPending(interview.status)),
    watch('screeningReports', 'screeningReports', report => (report.status || 'completed') === 'completed'),
  ]

  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}
