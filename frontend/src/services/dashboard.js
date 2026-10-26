import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'

export function subscribeToDashboardStats(userId, onChange, onReady, onError) {
  const stats = {
    jobDescriptions: 0,
    pendingInterviews: 0,
    screeningReports: 0,
  }
  const pendingSources = new Set(Object.keys(stats))

  const watchCount = (key, collectionName, filters) => onSnapshot(
    query(collection(db, collectionName), ...filters),
    snapshot => {
      stats[key] = snapshot.size
      pendingSources.delete(key)
      onChange({ ...stats })
      if (pendingSources.size === 0) onReady()
    },
    error => {
      pendingSources.delete(key)
      onError(error)
      if (pendingSources.size === 0) onReady()
    },
  )

  const unsubscribers = [
    watchCount('jobDescriptions', 'jobs', [
      where('ownerId', '==', userId),
      where('status', '==', 'ready'),
    ]),
    watchCount('pendingInterviews', 'interviews', [
      where('ownerId', '==', userId),
      where('status', '==', 'scheduled'),
    ]),
    watchCount('screeningReports', 'screeningReports', [
      where('ownerId', '==', userId),
      where('status', '==', 'completed'),
    ]),
  ]

  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}
