import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { timestampMs } from '../utils/format.js'

/**
 * The three most recent ready jobs with:
 *  - candidateCount: distinct candidates screened for the job
 *  - workflowStatus: New / In progress / Completed
 */
export function subscribeToHomeJobs(userId, onChange, onReady, onError) {
  const data = { jobs: [], screeningReports: [], interviews: [] }
  const pending = new Set(Object.keys(data))

  const emit = () => {
    const candidatesByJob = new Map()
    data.screeningReports
      .filter(report => (report.status || 'completed') === 'completed')
      .forEach(report => {
        if (!report.jobId) return
        if (!candidatesByJob.has(report.jobId)) candidatesByJob.set(report.jobId, new Set())
        ;(report.candidateIds || []).forEach(id => candidatesByJob.get(report.jobId).add(id))
      })
    const interviewJobIds = new Set(data.interviews.map(interview => interview.jobId))

    onChange(data.jobs
      .filter(job => job.status === 'ready')
      .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt))
      .slice(0, 3)
      .map(job => {
        const candidateCount = candidatesByJob.get(job.id)?.size || 0
        let workflowStatus = 'New'
        let statusTone = 'live'
        if (candidateCount || interviewJobIds.has(job.id)) {
          workflowStatus = 'In progress'
          statusTone = 'warn'
        }
        if (job.closedAt) {
          workflowStatus = 'Completed'
          statusTone = 'ok'
        }
        return { ...job, candidateCount, workflowStatus, statusTone }
      }))
  }

  const watch = key => onSnapshot(
    query(collection(db, key), where('ownerId', '==', userId)),
    snapshot => {
      data[key] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      pending.delete(key)
      emit()
      if (pending.size === 0) onReady()
    },
    error => {
      pending.delete(key)
      onError(error)
      if (pending.size === 0) onReady()
    },
  )

  const unsubscribers = Object.keys(data).map(watch)
  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}
