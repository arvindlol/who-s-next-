'use strict'

/**
 * Turns a stored file reference into a Storage object path.
 * Accepts a plain path ("resumes/uid/file.pdf") or a Firebase download URL
 * (".../o/resumes%2Fuid%2Ffile.pdf?alt=media&token=…"). Returns '' when it can't.
 */
function storagePathFromValue(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const reference = value.trim()

  if (!/^https?:\/\//i.test(reference)) return reference.replace(/^\/+/, '')

  try {
    const url = new URL(reference)
    const encoded = url.pathname.split('/o/')[1]
    return encoded ? decodeURIComponent(encoded) : ''
  } catch {
    return ''
  }
}

/** Resume path of a candidate document, supporting every field name used so far. */
function candidateResumePath(candidate) {
  return storagePathFromValue(candidate?.resumePath)
    || storagePathFromValue(candidate?.resume)
    || storagePathFromValue(candidate?.resumeUrl)
}

function isSafePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.split('/').some(part => part === '..' || part === '')
}

function isOwnedResumePath(path, uid) {
  return isSafePath(path) && path.startsWith(`resumes/${uid}/`)
}

function isOwnedJobPath(path, uid, jobId) {
  return isSafePath(path) && path.startsWith(`users/${uid}/jobs/${jobId}/`)
}

/** Original file name without the "{candidateId}-{timestamp}-" prefix added at upload. */
function displayFileName(path, candidateId = '') {
  let name = String(path || '').split('/').pop() || ''
  if (candidateId && name.startsWith(`${candidateId}-`)) name = name.slice(candidateId.length + 1)
  return name.replace(/^\d{10,}-/, '') || 'Uploaded resume'
}

module.exports = {
  storagePathFromValue,
  candidateResumePath,
  isOwnedResumePath,
  isOwnedJobPath,
  displayFileName,
}
