'use strict'

const { db, bucket, logger } = require('./firebase')
const { fail, AppError } = require('../lib/appError')
const { cleanText, uniqueTextItems } = require('../lib/text')
const { candidateResumePath, isOwnedResumePath, isOwnedJobPath } = require('../lib/storagePaths')
const { normalizeCandidateStage } = require('../lib/statuses')
const { LIMITS } = require('../config')

async function loadOwnedJob(uid, jobId, { requireReady = true } = {}) {
  const snapshot = await db.collection('jobs').doc(jobId).get()
  if (!snapshot.exists || snapshot.get('ownerId') !== uid || snapshot.get('status') === 'deleted') {
    fail('permission-denied', 'The selected job is unavailable.')
  }

  const job = snapshot.data()
  const storagePath = typeof job.storagePath === 'string' ? job.storagePath.trim() : ''
  if (requireReady && (job.status !== 'ready' || !storagePath)) {
    fail('failed-precondition', 'The job description upload has not finished. Wait a moment or upload it again.')
  }
  if (storagePath && !isOwnedJobPath(storagePath, uid, jobId)) {
    fail('permission-denied', 'The job description file location is invalid.')
  }

  return {
    id: jobId,
    title: cleanText(job.title, 150) || 'Untitled job',
    additionalCriteria: uniqueTextItems(Array.isArray(job.additionalCriteria) ? job.additionalCriteria : [job.additionalCriteria], 20, 400),
    storagePath,
    data: job,
  }
}

async function loadOwnedCandidates(uid, candidateIds, { requireResume = true } = {}) {
  const snapshots = await Promise.all(candidateIds.map(id => db.collection('candidates').doc(id).get()))

  return snapshots.map((snapshot, index) => {
    if (!snapshot.exists || snapshot.get('ownerId') !== uid || snapshot.get('deletedAt')) {
      fail('permission-denied', 'One of the selected candidates is unavailable.')
    }
    const data = snapshot.data()
    const name = cleanText(data.name, 120) || 'Unnamed candidate'
    const resumePath = candidateResumePath(data)

    if (requireResume && !resumePath) {
      fail('failed-precondition', `${name} has no uploaded resume. Add a PDF resume first.`)
    }
    if (resumePath && !isOwnedResumePath(resumePath, uid)) {
      fail('permission-denied', `${name}'s resume file location is invalid.`)
    }

    return {
      id: candidateIds[index],
      name,
      role: cleanText(data.role, 150),
      skills: uniqueTextItems(Array.isArray(data.skills) ? data.skills : String(data.skills || '').split(/[·,]/), 20),
      stage: normalizeCandidateStage(data.status),
      resumePath,
      data,
    }
  })
}

/** Downloads a Storage object and checks it is a non-empty PDF within the size limit. */
async function downloadPdf(storagePath, label) {
  const file = bucket().file(storagePath)
  try {
    const [[contents], [metadata]] = await Promise.all([file.download(), file.getMetadata()])

    if (contents.length === 0 || contents.length > LIMITS.maxPdfBytes) {
      fail('failed-precondition', `${label} must be a non-empty PDF no larger than 10 MB.`)
    }
    if (contents.subarray(0, 5).toString('ascii') !== '%PDF-') {
      fail('failed-precondition', `${label} is not a PDF. Re-upload it as a PDF file.`)
    }

    return {
      contents,
      filename: storagePath.split('/').pop() || `${label}.pdf`,
      contentType: metadata.contentType || 'application/pdf',
      sizeBytes: contents.length,
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    logger.error('PDF download failed.', { label, error: error?.code || error?.name || 'UnknownError' })
    fail('not-found', `${label} could not be found in storage. Upload it again.`)
  }
}

module.exports = { loadOwnedJob, loadOwnedCandidates, downloadPdf }
