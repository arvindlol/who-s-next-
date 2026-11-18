'use strict'

const { db, bucket, getAuth, FieldValue, logger, deleteRefs } = require('./firebase')
const { fail } = require('../lib/appError')
const { candidateResumePath, isOwnedResumePath } = require('../lib/storagePaths')
const { summarizeScreening } = require('../lib/screening')

const OWNED_COLLECTIONS = [
  'jobs',
  'screeningReports',
  'interviews',
  'interviewReports',
  'interviewTranscripts',
  'aiRequestDiagnostics',
  'rateLimits',
]

async function deleteStoragePrefix(prefix) {
  try {
    await bucket().deleteFiles({ prefix, force: true })
  } catch (error) {
    logger.warn('Storage prefix delete failed.', { prefix, error: error?.code || error?.name })
  }
}

async function deleteStorageFile(path) {
  try {
    await bucket().file(path).delete({ ignoreNotFound: true })
  } catch (error) {
    logger.warn('Storage file delete failed.', { error: error?.code || error?.name })
  }
}

/** Deletes interviews plus their transcripts and reports. */
async function deleteInterviews(interviewSnapshots) {
  const refs = []
  interviewSnapshots.forEach(snapshot => {
    refs.push(
      db.collection('interviewReports').doc(snapshot.id),
      db.collection('interviewTranscripts').doc(snapshot.id),
      snapshot.ref,
    )
  })
  await deleteRefs(refs)
}

/**
 * Removes one candidate from a screening report. The report is deleted when no candidates remain;
 * otherwise counts and ranking are recomputed and the model-written comparison text is dropped,
 * because it may mention the removed candidate.
 */
async function removeCandidateFromReport(reportSnapshot, candidateId) {
  const report = reportSnapshot.data()
  const remaining = (report.results || [])
    .filter(result => result.candidateId !== candidateId)
    .sort((first, second) => (first.rank || 0) - (second.rank || 0))
    .map((result, index) => ({ ...result, rank: index + 1 }))

  if (remaining.length === 0) {
    await reportSnapshot.ref.delete()
    return
  }

  await reportSnapshot.ref.update({
    results: remaining,
    candidateIds: remaining.map(result => result.candidateId),
    screeningSummary: summarizeScreening(remaining, {
      overview: 'This comparison was updated after a candidate was deleted. Review the individual reports.',
    }),
    candidateRemovedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/** Full erasure of a candidate: resume files, interviews, reports, screening entries, activity and profile. */
async function deleteCandidateData(uid, candidateId) {
  const ref = db.collection('candidates').doc(candidateId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return { deleted: false }
  if (snapshot.get('ownerId') !== uid) fail('permission-denied', 'This candidate is unavailable.')

  const resumePath = candidateResumePath(snapshot.data())
  if (resumePath && isOwnedResumePath(resumePath, uid)) await deleteStorageFile(resumePath)
  await deleteStoragePrefix(`resumes/${uid}/${candidateId}-`)

  const [interviews, reports] = await Promise.all([
    db.collection('interviews').where('ownerId', '==', uid).where('candidateId', '==', candidateId).get(),
    db.collection('screeningReports').where('ownerId', '==', uid).get(),
  ])
  await deleteInterviews(interviews.docs)

  for (const report of reports.docs) {
    const ids = report.get('candidateIds') || []
    const inResults = (report.get('results') || []).some(result => result.candidateId === candidateId)
    if (ids.includes(candidateId) || inResults) await removeCandidateFromReport(report, candidateId)
  }

  await db.recursiveDelete(ref)
  return { deleted: true }
}

/** Full erasure of a job: JD file, screenings and interviews for that job, and the job itself. */
async function deleteJobData(uid, jobId) {
  const ref = db.collection('jobs').doc(jobId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return { deleted: false }
  if (snapshot.get('ownerId') !== uid) fail('permission-denied', 'This job is unavailable.')

  await deleteStoragePrefix(`users/${uid}/jobs/${jobId}/`)

  const [reports, interviews] = await Promise.all([
    db.collection('screeningReports').where('ownerId', '==', uid).where('jobId', '==', jobId).get(),
    db.collection('interviews').where('ownerId', '==', uid).where('jobId', '==', jobId).get(),
  ])
  await deleteInterviews(interviews.docs)
  await deleteRefs(reports.docs.map(report => report.ref))
  await ref.delete()
  return { deleted: true }
}

/** Deletes everything the user owns, then the Auth account itself. */
async function deleteAccountData(uid) {
  const candidates = await db.collection('candidates').where('ownerId', '==', uid).get()
  for (const candidate of candidates.docs) await db.recursiveDelete(candidate.ref)

  for (const name of OWNED_COLLECTIONS) {
    const snapshot = await db.collection(name).where('ownerId', '==', uid).get()
    await deleteRefs(snapshot.docs.map(doc => doc.ref))
  }

  await deleteRefs([db.collection('userSecrets').doc(uid), db.collection('users').doc(uid)])
  await Promise.all([deleteStoragePrefix(`users/${uid}/`), deleteStoragePrefix(`resumes/${uid}/`)])
  await getAuth().deleteUser(uid)
  return { deleted: true }
}

module.exports = { deleteCandidateData, deleteJobData, deleteAccountData }
