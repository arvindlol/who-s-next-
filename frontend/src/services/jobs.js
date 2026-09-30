import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { db, storage } from '../firebase.js'

export const MAX_JOB_FILE_SIZE = 10 * 1024 * 1024
export const ACCEPTED_JOB_FILE_TYPES = '.pdf,.doc,.docx,.txt'

const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'txt'])

function extensionOf(filename) {
  return filename.split('.').pop()?.toLowerCase() || ''
}

function safeFilename(filename) {
  return filename
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
}

export function validateJobFile(file) {
  if (!file) return 'Choose a job description file.'
  if (!allowedExtensions.has(extensionOf(file.name))) {
    return 'Upload a PDF, DOC, DOCX, or TXT file.'
  }
  if (file.size > MAX_JOB_FILE_SIZE) {
    return 'The job description must be 10 MB or smaller.'
  }
  return ''
}

export function subscribeToJobs(userId, onChange, onError) {
  const jobsQuery = query(
    collection(db, 'jobs'),
    where('ownerId', '==', userId),
    orderBy('createdAt', 'desc'),
  )

  return onSnapshot(
    jobsQuery,
    snapshot => {
      const jobs = snapshot.docs.map(job => ({ id: job.id, ...job.data() }))
      onChange(jobs)
    },
    onError,
  )
}

export function subscribeToJobActivity(userId, onChange, onError) {
  const jobIdsBySource = {
    matches: new Set(),
    screeningReports: new Set(),
    interviews: new Set(),
  }

  const emit = () => {
    onChange(new Set(Object.values(jobIdsBySource).flatMap(jobIds => [...jobIds])))
  }

  const watch = collectionName => onSnapshot(
    query(collection(db, collectionName), where('ownerId', '==', userId)),
    snapshot => {
      jobIdsBySource[collectionName] = new Set(
        snapshot.docs.map(item => item.data().jobId).filter(Boolean),
      )
      emit()
    },
    onError,
  )

  const unsubscribers = [watch('matches'), watch('screeningReports'), watch('interviews')]
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

export async function deleteJob(job) {
  if (job.storagePath) {
    try {
      await deleteObject(ref(storage, job.storagePath))
    } catch (error) {
      if (error?.code !== 'storage/object-not-found') throw error
    }
  }
  await deleteDoc(doc(db, 'jobs', job.id))
}

export async function createJob({ userId, title, file, onProgress }) {
  const jobRef = doc(collection(db, 'jobs'))
  const filename = safeFilename(file.name)
  const storagePath = `users/${userId}/jobs/${jobRef.id}/${filename}`

  await setDoc(jobRef, {
    ownerId: userId,
    title: title.trim(),
    originalFilename: file.name,
    storagePath,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
    status: 'uploading',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  try {
    const uploadTask = uploadBytesResumable(ref(storage, storagePath), file, {
      contentType: file.type || undefined,
    })

    await new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        snapshot => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          onProgress?.(progress)
        },
        reject,
        resolve,
      )
    })

    await updateDoc(jobRef, {
      status: 'ready',
      updatedAt: serverTimestamp(),
    })

    return jobRef.id
  } catch (error) {
    await updateDoc(jobRef, {
      status: 'failed',
      updatedAt: serverTimestamp(),
    }).catch(() => {})
    throw error
  }
}

export function getJobFileUrl(storagePath) {
  return getDownloadURL(ref(storage, storagePath))
}
