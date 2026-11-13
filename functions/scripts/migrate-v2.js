'use strict'

/**
 * One-off data migration to the unified data model (run once after deploying this version).
 *
 *   cd functions
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
 *   node scripts/migrate-v2.js --project <project-id>            # dry run: prints what would change
 *   node scripts/migrate-v2.js --project <project-id> --apply    # writes the changes
 *
 * Optional: set GEMINI_KEY_ENCRYPTION_KEY (same base64 value as the Secret Manager secret) to also
 * re-encrypt version-1 Gemini keys as version 2. Without it, keys are upgraded lazily on next use.
 *
 * What it does:
 *  - candidates: resumePath/resumeUrl/resumeName from the legacy `resume` field, skills as an array,
 *    stage names normalised (e.g. "Interview ready" → "Interview Ready", "Selected" → "Hired").
 *  - interviews: legacy status names mapped, `round` added.
 *  - screeningReports: missing `status` set to "completed".
 *  - jobs: ready jobs whose file is not a PDF are flagged with fileIssue = "not_pdf".
 */

const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { candidateResumePath, displayFileName, storagePathFromValue } = require('../src/lib/storagePaths')
const { normalizeCandidateStage } = require('../src/lib/statuses')
const { uniqueTextItems } = require('../src/lib/text')
const { parseMasterKey, encryptSecret, decryptSecret } = require('../src/lib/crypto')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const projectIndex = args.indexOf('--project')
const projectId = projectIndex >= 0 ? args[projectIndex + 1] : process.env.GCLOUD_PROJECT

if (!projectId) {
  console.error('Usage: node scripts/migrate-v2.js --project <project-id> [--apply]')
  process.exit(1)
}

initializeApp({ projectId })
const db = getFirestore()

const LEGACY_INTERVIEW_STATUSES = {
  draft: 'plan_needed',
  approved: 'plan_approved',
  scheduled: 'plan_approved',
  invited: 'plan_approved',
  in_progress: 'plan_approved',
  completed: 'transcript_submitted',
  awaiting_transcript: 'plan_approved',
  reviewed: 'decided',
}

const stats = {}
const count = key => { stats[key] = (stats[key] || 0) + 1 }

async function forEachDoc(collection, handler) {
  const snapshot = await db.collection(collection).get()
  let batch = db.batch()
  let pending = 0
  for (const doc of snapshot.docs) {
    const update = handler(doc.data(), doc)
    if (!update || Object.keys(update).length === 0) continue
    count(`${collection}: updated`)
    if (!apply) {
      console.log(`[dry-run] ${collection}/${doc.id}`, JSON.stringify(update))
      continue
    }
    batch.update(doc.ref, { ...update, migratedAt: FieldValue.serverTimestamp() })
    pending += 1
    if (pending === 400) {
      await batch.commit()
      batch = db.batch()
      pending = 0
    }
  }
  if (apply && pending) await batch.commit()
}

function migrateCandidate(data, doc) {
  const update = {}
  const path = candidateResumePath(data)

  if (path && data.resumePath !== path) update.resumePath = path
  if (!data.resumeUrl && /^https?:\/\//.test(data.resume || '')) update.resumeUrl = data.resume
  if (path && !data.resumeName) update.resumeName = displayFileName(path, doc.id)

  if (typeof data.skills === 'string') {
    update.skills = uniqueTextItems(data.skills.split(/[·,]/), 30, 80)
  }

  const stage = normalizeCandidateStage(data.status)
  if (data.status !== stage) update.status = stage

  if (typeof data.ratingSum !== 'number') update.ratingSum = 0
  if (typeof data.ratingCount !== 'number') update.ratingCount = 0
  return update
}

function migrateInterview(data) {
  const update = {}
  const key = String(data.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (LEGACY_INTERVIEW_STATUSES[key]) update.status = LEGACY_INTERVIEW_STATUSES[key]
  if (!data.round) update.round = 1
  return update
}

function migrateScreening(data) {
  return data.status ? null : { status: 'completed' }
}

function migrateJob(data) {
  if (data.status !== 'ready' || data.fileIssue) return null
  const name = String(data.originalFilename || storagePathFromValue(data.storagePath) || '').toLowerCase()
  return name.endsWith('.pdf') ? null : { fileIssue: 'not_pdf' }
}

async function migrateKeys() {
  if (!process.env.GEMINI_KEY_ENCRYPTION_KEY) {
    console.log('GEMINI_KEY_ENCRYPTION_KEY not set — version-1 keys will be upgraded on next use.')
    return
  }
  const legacySnapshot = await db.collection('systemSecrets').doc('geminiEncryption').get()
  if (!legacySnapshot.exists) {
    console.log('No legacy master key found — nothing to re-encrypt.')
    return
  }
  const legacyKey = parseMasterKey(legacySnapshot.get('masterKey'))
  const newKey = parseMasterKey(process.env.GEMINI_KEY_ENCRYPTION_KEY)

  const secrets = await db.collection('userSecrets').where('encryptionVersion', '==', 1).get()
  for (const doc of secrets.docs) {
    try {
      const apiKey = decryptSecret(doc.data(), legacyKey, doc.id)
      count('userSecrets: re-encrypted')
      if (apply) await doc.ref.update({ ...encryptSecret(apiKey, newKey, doc.id, 2), updatedAt: FieldValue.serverTimestamp() })
    } catch {
      count('userSecrets: could not decrypt (user must re-save key)')
    }
  }

  const remaining = apply ? (await db.collection('userSecrets').where('encryptionVersion', '==', 1).get()).size : -1
  if (apply && remaining === 0) {
    console.log('All keys use version 2. You can now delete systemSecrets/geminiEncryption in the console.')
  }
}

async function main() {
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} migration on project ${projectId}`)
  await forEachDoc('candidates', migrateCandidate)
  await forEachDoc('interviews', migrateInterview)
  await forEachDoc('screeningReports', migrateScreening)
  await forEachDoc('jobs', migrateJob)
  await migrateKeys()
  console.log('Summary:', stats)
  if (!apply) console.log('Nothing was written. Re-run with --apply to make these changes.')
}

main().catch(error => {
  console.error('Migration failed:', error)
  process.exit(1)
})
