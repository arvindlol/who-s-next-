import {
  collection,
  deleteField,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase.js'
import { api } from './api.js'
import { newCandidateFields, normalizeCandidate, parseSkills, resumeStoragePath } from '../utils/candidateModel.js'

// Each candidate can write 2 documents (candidate + activity) per batch, so 200 stays under 500.
const BATCH_SIZE = 200

const candidateRef = id => doc(db, 'candidates', id)
const newActivityRef = id => doc(collection(db, 'candidates', id, 'activity'))

async function commitInBatches(items, apply) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    items.slice(i, i + BATCH_SIZE).forEach(item => apply(batch, item))
    await batch.commit()
  }
}

/** Activity entry (validated by the Firestore rules: type, text ≤ 3000, byUid = signed-in user). */
export function activityEntry(user, type, text, extra = {}) {
  return {
    type,
    text: String(text || '').slice(0, 3000),
    ...extra,
    by: (user?.name || user?.email || 'You').slice(0, 200),
    byUid: user.uid,
    createdAt: serverTimestamp(),
  }
}

/** Live list of the user's candidates (soft-deleted ones excluded), newest first. */
export function subscribeToCandidates(uid, onChange, onError) {
  return onSnapshot(
    query(collection(db, 'candidates'), where('ownerId', '==', uid)),
    snapshot => {
      const candidates = snapshot.docs
        .map(item => normalizeCandidate(item.id, item.data({ serverTimestamps: 'estimate' })))
        .filter(candidate => !candidate.deleted)
        .sort((a, b) => b.createdMs - a.createdMs)
      onChange(candidates)
    },
    onError,
  )
}

export function subscribeToActivity(candidateId, onChange, onError) {
  return onSnapshot(
    query(collection(db, 'candidates', candidateId, 'activity'), orderBy('createdAt', 'desc'), limit(25)),
    snapshot => onChange(snapshot.docs.map(item => {
      const data = item.data({ serverTimestamps: 'estimate' })
      return {
        id: item.id,
        type: data.type || 'note',
        text: data.text || '',
        rating: Number(data.rating) || 0,
        by: data.by || '',
        ms: data.createdAt?.toMillis?.() ?? Date.now(),
      }
    })),
    onError,
  )
}

export function newCandidateId() {
  return doc(collection(db, 'candidates')).id
}

export async function createCandidate(user, candidateId, values) {
  await setDoc(candidateRef(candidateId), {
    ownerId: user.uid,
    ...newCandidateFields(values),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  logActivity(user, candidateId, 'created', 'Added to the pipeline at Screening')
}

export async function updateCandidate(user, candidateId, values) {
  await updateDoc(candidateRef(candidateId), {
    name: values.name,
    role: values.role,
    email: values.email,
    phone: values.phone || '',
    skills: parseSkills(values.skills),
    additionalinformation: values.notes || '',
    updatedAt: serverTimestamp(),
  })
  logActivity(user, candidateId, 'edited', 'Profile details updated')
}

/** Best-effort timeline entry; a failure never blocks the main action. */
export function logActivity(user, candidateId, type, text) {
  if (!user?.uid || !candidateId) return Promise.resolve()
  return setDoc(newActivityRef(candidateId), activityEntry(user, type, text)).catch(error => {
    console.warn('Activity not saved:', error?.code || error)
  })
}

export async function setCandidateStage(user, candidate, stage) {
  const batch = writeBatch(db)
  batch.update(candidateRef(candidate.id), { status: stage, updatedAt: serverTimestamp() })
  batch.set(newActivityRef(candidate.id), activityEntry(user, 'status', `Moved from ${candidate.status} to ${stage}`))
  await batch.commit()
}

export function setStageForMany(user, candidates, stage) {
  return commitInBatches(candidates, (batch, candidate) => {
    batch.update(candidateRef(candidate.id), { status: stage, updatedAt: serverTimestamp() })
    batch.set(newActivityRef(candidate.id), activityEntry(user, 'status', `Moved from ${candidate.status} to ${stage}`))
  })
}

export async function saveFeedback(user, candidateId, rating, text) {
  const batch = writeBatch(db)
  batch.update(candidateRef(candidateId), {
    ratingSum: increment(rating),
    ratingCount: increment(1),
    updatedAt: serverTimestamp(),
  })
  batch.set(newActivityRef(candidateId), activityEntry(user, 'feedback', text, { rating }))
  await batch.commit()
}

/**
 * Uploads a PDF resume to resumes/{uid}/{candidateId}-{timestamp}-{name} and points the candidate
 * at it. The previous file (from any older field format) is removed afterwards.
 */
export async function uploadResume(user, candidateId, file, previousPath = '') {
  const path = resumeStoragePath(user.uid, candidateId, file.name)
  const fileRef = ref(storage, path)
  await uploadBytes(fileRef, file, { contentType: 'application/pdf' })

  try {
    const resumeUrl = await getDownloadURL(fileRef)
    await updateDoc(candidateRef(candidateId), {
      resumePath: path,
      resumeUrl,
      resumeName: file.name.slice(0, 255),
      resume: deleteField(), // legacy field; resumePath is now authoritative
      updatedAt: serverTimestamp(),
    })
  } catch (error) {
    await deleteObject(fileRef).catch(() => {})
    throw error
  }

  logActivity(user, candidateId, 'resume', previousPath ? `Resume replaced (${file.name})` : `Resume attached (${file.name})`)

  if (previousPath && previousPath !== path) {
    await deleteObject(ref(storage, previousPath)).catch(error => {
      if (error?.code !== 'storage/object-not-found') console.warn('Old resume not removed:', error?.code || error)
    })
  }
  return path
}

/** Hides candidates immediately; the server deletes them for good after the undo window. */
export function softDeleteCandidates(candidates) {
  return commitInBatches(candidates, (batch, candidate) => {
    batch.update(candidateRef(candidate.id), { deletedAt: serverTimestamp() })
  })
}

export function restoreCandidates(candidates) {
  return commitInBatches(candidates, (batch, candidate) => {
    batch.update(candidateRef(candidate.id), { deletedAt: deleteField() })
  })
}

/** Permanently deletes candidates and everything linked to them (resume, interviews, reports). */
export async function purgeCandidates(candidateIds) {
  const results = await Promise.allSettled(candidateIds.map(candidateId => api.deleteCandidate({ candidateId })))
  const failed = results.filter(result => result.status === 'rejected')
  if (failed.length) console.warn(`${failed.length} candidate deletion(s) will be finished by the nightly clean-up.`)
}

export function importCandidates(user, items) {
  return commitInBatches(items, (batch, item) => {
    batch.set(doc(collection(db, 'candidates')), {
      ownerId: user.uid,
      ...newCandidateFields(item),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
}
