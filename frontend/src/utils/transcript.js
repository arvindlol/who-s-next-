// Transcript helpers (no browser or Firebase dependencies, so they can be unit-tested).

const TIMESTAMP_LINE = /^\s*\d{1,2}:\d{2}(:\d{2})?([.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(:\d{2})?([.,]\d{1,3})?/

/**
 * Converts WebVTT / SRT subtitle exports (Teams, Zoom, Meet) into "Speaker: text" lines.
 * Plain text is returned unchanged apart from line-ending clean-up.
 */
export function normalizeTranscriptText(raw, fileName = '') {
  const text = String(raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const isSubtitle = /\.(vtt|srt)$/i.test(fileName) || /^WEBVTT/.test(text) || TIMESTAMP_LINE.test(text.split('\n').slice(0, 5).join('\n'))
  if (!isSubtitle) return text.trim()

  const lines = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'WEBVTT' || /^\d+$/.test(trimmed) || TIMESTAMP_LINE.test(trimmed) || /^(NOTE|STYLE|REGION)\b/.test(trimmed)) continue

    // WebVTT voice tags: <v Asha Rao>Hello</v>
    const voice = trimmed.match(/^<v(?:\.[^ >]+)?\s+([^>]+)>(.*?)(?:<\/v>)?$/)
    const content = voice ? `${voice[1].trim()}: ${voice[2]}` : trimmed
    const clean = content.replace(/<[^>]+>/g, '').trim()
    if (!clean) continue

    // Merge consecutive cues from the same speaker.
    const speaker = clean.match(/^([^:\n]{1,40}):\s*(.*)$/)
    const previous = lines[lines.length - 1]
    const previousSpeaker = previous?.match(/^([^:\n]{1,40}):/)?.[1]
    if (speaker && previousSpeaker === speaker[1]) lines[lines.length - 1] = `${previous} ${speaker[2]}`
    else if (!speaker && previous) lines[lines.length - 1] = `${previous} ${clean}`
    else lines.push(clean)
  }
  return lines.join('\n')
}

/** Distinct "Label:" speaker prefixes at the start of lines (max 8). */
export function transcriptSpeakers(transcript, candidateName = '') {
  const labels = []
  const seen = new Set()
  const matcher = /^\s*([^:\n]{1,40}):/gm
  let match = matcher.exec(transcript)
  while (match && labels.length < 8) {
    const label = match[1].trim()
    // Ignore timestamps such as "00:12".
    if (label && !/^\d+$/.test(label) && !seen.has(label.toLowerCase())) {
      labels.push(label)
      seen.add(label.toLowerCase())
    }
    match = matcher.exec(transcript)
  }
  return labels.length ? labels : ['Interviewer', String(candidateName).split(/\s+/)[0] || 'Candidate']
}

export function suggestedSpeakerRole(label, candidateName = '') {
  const normalized = label.toLowerCase()
  const nameParts = String(candidateName).toLowerCase().split(/\s+/).filter(Boolean)
  if (/interviewer|recruiter|hiring manager|panel/.test(normalized)) return 'interviewer'
  if (normalized === 'candidate' || nameParts.some(part => normalized.split(/\s+/).includes(part))) return 'candidate'
  return 'other'
}
