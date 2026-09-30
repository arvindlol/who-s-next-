import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'

function timestampValue(timestamp) {
  return timestamp?.toMillis?.() || 0
}

export function subscribeToHomeJobs(userId, onChange, onReady, onError) {
  const data = {
    jobs: [],
    matches: [],
    screeningReports: [],
    interviews: [],
  }
  const pendingSources = new Set(Object.keys(data))

  const emit = () => {
    const candidateIdsByJob = new Map()

    data.matches.forEach(match => {
      if (!match.jobId) return
      const candidateKey = match.candidateId || match.resumeId || match.id
      if (!candidateIdsByJob.has(match.jobId)) candidateIdsByJob.set(match.jobId, new Set())
      candidateIdsByJob.get(match.jobId).add(candidateKey)
    })

    const reportJobIds = new Set(
      data.screeningReports
        .filter(report => !report.status || report.status.toLowerCase() === 'completed')
        .map(report => report.jobId),
    )
    const interviewJobIds = new Set(
      data.interviews
        .filter(interview => interview.status?.toLowerCase() === 'scheduled')
        .map(interview => interview.jobId),
    )

    const jobs = data.jobs
      .filter(job => job.status === 'ready')
      .sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt))
      .slice(0, 3)
      .map(job => {
        const hasActivity = candidateIdsByJob.has(job.id)
          || reportJobIds.has(job.id)
          || interviewJobIds.has(job.id)
        let workflowStatus = 'New'
        let statusTone = 'live'

        if (hasActivity) {
          workflowStatus = 'In progress'
          statusTone = 'warn'
        }
        if (job.closedAt) {
          workflowStatus = 'Completed'
          statusTone = 'ok'
        }

        return {
          ...job,
          candidateCount: candidateIdsByJob.get(job.id)?.size || 0,
          workflowStatus,
          statusTone,
        }
      })

    onChange(jobs)
  }

  const watch = (key, collectionName) => onSnapshot(
    query(collection(db, collectionName), where('ownerId', '==', userId)),
    snapshot => {
      data[key] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      pendingSources.delete(key)
      emit()
      if (pendingSources.size === 0) onReady()
    },
    error => {
      pendingSources.delete(key)
      onError(error)
      if (pendingSources.size === 0) onReady()
    },
  )

  const unsubscribers = [
    watch('jobs', 'jobs'),
    watch('matches', 'matches'),
    watch('screeningReports', 'screeningReports'),
    watch('interviews', 'interviews'),
  ]

  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}
