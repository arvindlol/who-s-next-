import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTranscriptText, suggestedSpeakerRole, transcriptSpeakers } from '../src/utils/transcript.js'

test('WebVTT exports become "Speaker: text" lines with merged cues', () => {
  const vtt = [
    'WEBVTT',
    '',
    '1',
    '00:00:01.000 --> 00:00:04.000',
    '<v Interviewer>Thanks for joining.</v>',
    '',
    '2',
    '00:00:05.000 --> 00:00:08.000',
    '<v Asha Rao>Happy to be here.</v>',
    '',
    '3',
    '00:00:08.500 --> 00:00:10.000',
    '<v Asha Rao>Let me start with my background.</v>',
  ].join('\n')

  assert.equal(
    normalizeTranscriptText(vtt, 'meeting.vtt'),
    'Interviewer: Thanks for joining.\nAsha Rao: Happy to be here. Let me start with my background.',
  )
})

test('SRT exports drop cue numbers and timestamps', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\nInterviewer: Hello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nCandidate: Hi'
  assert.equal(normalizeTranscriptText(srt, 'call.srt'), 'Interviewer: Hello\nCandidate: Hi')
})

test('plain text is kept as it is', () => {
  assert.equal(normalizeTranscriptText('Interviewer: Hi\nCandidate: Hello\n', 'notes.txt'), 'Interviewer: Hi\nCandidate: Hello')
})

test('speakers are detected and roles suggested', () => {
  const speakers = transcriptSpeakers('Interviewer: Hi\nAsha: Hello\n00:12: noise\nInterviewer: Next')
  assert.deepEqual(speakers, ['Interviewer', 'Asha'])
  assert.equal(suggestedSpeakerRole('Interviewer'), 'interviewer')
  assert.equal(suggestedSpeakerRole('Asha', 'Asha Rao'), 'candidate')
  assert.equal(suggestedSpeakerRole('Asha Rao', 'Asha Rao'), 'candidate')
  assert.equal(suggestedSpeakerRole('Bob', 'Asha Rao'), 'other')
  assert.deepEqual(transcriptSpeakers('', 'Asha Rao'), ['Interviewer', 'Asha'])
})
