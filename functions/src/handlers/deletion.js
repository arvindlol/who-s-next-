'use strict'

const { onSchedule } = require('firebase-functions/v2/scheduler')
const { callable } = require('./callable')
const { fail } = require('../lib/appError')
const { requireDocumentId } = require('../lib/validation')
const { REGION, LIMITS } = require('../config')
const { db, Timestamp, logger } = require('../services/firebase')
const { deleteCandidateData, deleteJobData, deleteAccountData } = require('../services/deletion')

const deleteCandidate = callable('deleteCandidate', { timeoutSeconds: 300 }, async (data, { uid }) => {
  const candidateId = requireDocumentId(data.candidateId, 'candidate ID')
  return deleteCandidateData(uid, candidateId)
})

const deleteJob = callable('deleteJob', { timeoutSeconds: 300 }, async (data, { uid }) => {
  const jobId = requireDocumentId(data.jobId, 'job ID')
  return deleteJobData(uid, jobId)
})

const deleteAccount = callable('deleteAccount', { timeoutSeconds: 540, memory: '512MiB' }, async (data, { uid }) => {
  if (data.confirm !== 'DELETE') fail('invalid-argument', 'Type DELETE to confirm that your account should be removed.')
  return deleteAccountData(uid)
})

/**
 * Candidates are soft-deleted first (so the recruiter can undo for a few seconds); the client then
 * calls deleteCandidate. If the browser closed before that, this daily job finishes the deletion.
 */
const purgeDeletedCandidates = onSchedule({
  schedule: 'every 24 hours',
  region: REGION,
  timeoutSeconds: 540,
  memory: '512MiB',
}, async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - LIMITS.softDeleteRetentionMs)
  const snapshot = await db.collection('candidates').where('deletedAt', '<', cutoff).limit(200).get()

  let purged = 0
  for (const candidate of snapshot.docs) {
    try {
      await deleteCandidateData(candidate.get('ownerId'), candidate.id)
      purged += 1
    } catch (error) {
      logger.warn('Soft-deleted candidate could not be purged.', { candidateId: candidate.id, error: error?.message?.slice(0, 200) })
    }
  }
  logger.info('Soft-deleted candidates purged.', { purged, found: snapshot.size })
})

module.exports = { deleteCandidate, deleteJob, deleteAccount, purgeDeletedCandidates }
