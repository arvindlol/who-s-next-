'use strict'

const { db, FieldValue, logger } = require('./firebase')
const { nextCandidateStage, normalizeCandidateStage } = require('../lib/statuses')

const SYSTEM_ACTOR = 'Who’s Next'

/**
 * Moves a candidate forward after a workflow event and writes a timeline entry.
 * Best effort: a failure here is logged and never fails the main operation.
 */
async function recordCandidateEvent(uid, candidateId, { event, decision, text }) {
  try {
    const ref = db.collection('candidates').doc(candidateId)
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists || snapshot.get('ownerId') !== uid || snapshot.get('deletedAt')) return

      const currentStage = normalizeCandidateStage(snapshot.get('status'))
      const nextStage = nextCandidateStage(event, currentStage, decision)

      if (nextStage) {
        transaction.update(ref, { status: nextStage, updatedAt: FieldValue.serverTimestamp() })
      }

      const message = nextStage ? `${text} Stage moved from ${currentStage} to ${nextStage}.` : text
      transaction.set(ref.collection('activity').doc(), {
        type: nextStage ? 'status' : 'note',
        text: message.slice(0, 3000),
        by: SYSTEM_ACTOR,
        byUid: uid,
        createdAt: FieldValue.serverTimestamp(),
      })
    })
  } catch (error) {
    logger.warn('Candidate event could not be recorded.', { uid, candidateId, event, error: error?.code || error?.name })
  }
}

module.exports = { recordCandidateEvent }
