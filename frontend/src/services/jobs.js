import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { db, storage } from '../firebase.js'
import { api } from './api.js'

export const MAX_JOB_FILE_SIZE = 10 * 1024 * 1024
export const ACCEPTED_JOB_FILE_TYPES = '.pdf,application/pdf'

function safeFilename(filename) {
  return filename
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-150)
}

export function validateJobFile(file) {
  if (!file) return 'Choose a job description file.'
  const isPdf = /\.pdf$/i.test(file.name) && (!file.type || file.type === 'application/pdf')
  if (!isPdf) return 'Upload the job description as a PDF. Screening reads PDF files only.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_JOB_FILE_SIZE) return 'The job description must be 10 MB or smaller.'
  return ''
}

/** True for jobs uploaded before PDF-only uploads (they cannot be screened). */
export function jobNeedsPdf(job) {
  if (job.fileIssue === 'not_pdf') return true
  const name = String(job.originalFilename || job.storagePath || '').toLowerCase()
  return Boolean(name) && !name.endsWith('.pdf')
}

export function subscribeToJobs(userId, onChange, onError) {
  return onSnapshot(
    query(collection(db, 'jobs'), where('ownerId', '==', userId), orderBy('createdAt', 'desc')),
    snapshot => {
      onChange(snapshot.docs
        .map(job => ({ id: job.id, ...job.data() }))
        .filter(job => job.status !== 'deleted'))
    },
    onError,
  )
}

/** Job IDs that have any screening or interview activity. */
export function subscribeToJobActivity(userId, onChange, onError) {
  const jobIdsBySource = { screeningReports: new Set(), interviews: new Set() }
  const emit = () => onChange(new Set(Object.values(jobIdsBySource).flatMap(ids => [...ids])))

  const watch = collectionName => onSnapshot(
    query(collection(db, collectionName), where('ownerId', '==', userId)),
    snapshot => {
      jobIdsBySource[collectionName] = new Set(snapshot.docs.map(item => item.data().jobId).filter(Boolean))
      emit()
    },
    onError,
  )

  const unsubscribers = [watch('screeningReports'), watch('interviews')]
  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}

export function closeJob(jobId, userId) {
  return updateDoc(doc(db, 'jobs', jobId), {
    closedAt: serverTimestamp(),
    closedBy: userId,
    closeReason: deleteField(),
    updatedAt: serverTimestamp(),
  })
}

export function reopenJob(jobId) {
  return updateDoc(doc(db, 'jobs', jobId), {
    closedAt: deleteField(),
    closedBy: deleteField(),
    closeReason: deleteField(),
    updatedAt: serverTimestamp(),
  })
}

/** Permanently deletes the job, its file, and the screenings and interviews for it. */
export function deleteJob(jobId) {
  return api.deleteJob({ jobId })
}

export async function createJob({ userId, title, file, additionalCriteria = [], onProgress }) {
  const jobRef = doc(collection(db, 'jobs'))
  const storagePath = `users/${userId}/jobs/${jobRef.id}/${safeFilename(file.name)}`

  await setDoc(jobRef, {
    ownerId: userId,
    title: title.trim().slice(0, 150),
    originalFilename: file.name.slice(0, 255),
    storagePath,
    fileType: 'application/pdf',
    fileSize: file.size,
    additionalCriteria: additionalCriteria.slice(0, 20),
    status: 'uploading',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  try {
    const uploadTask = uploadBytesResumable(ref(storage, storagePath), file, { contentType: 'application/pdf' })
    await new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        snapshot => onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
        reject,
        resolve,
      )
    })

    await updateDoc(jobRef, { status: 'ready', updatedAt: serverTimestamp() })
    return jobRef.id
  } catch (error) {
    await updateDoc(jobRef, { status: 'failed', updatedAt: serverTimestamp() }).catch(() => {})
    throw error
  }
}

export function getJobFileUrl(storagePath) {
  return getDownloadURL(ref(storage, storagePath))
}
