'use strict'

const { initializeApp, getApps } = require('firebase-admin/app')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { getAuth } = require('firebase-admin/auth')
const { logger } = require('firebase-functions')

if (!getApps().length) initializeApp()

const db = getFirestore()
const bucket = () => getStorage().bucket()

/** Deletes document references in batches of 400. */
async function deleteRefs(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch()
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref))
    await batch.commit()
  }
}

/** Expiry timestamp for collections with a Firestore TTL policy on `expireAt`. */
function expireAfter(ms) {
  return Timestamp.fromMillis(Date.now() + ms)
}

module.exports = { db, bucket, getAuth, FieldValue, Timestamp, logger, deleteRefs, expireAfter }
