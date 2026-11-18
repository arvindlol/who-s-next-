'use strict'

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Runs of digits with common phone separators. Only 9–15 digits count as a phone number,
// so timestamps ("00:12") and year ranges ("2019-2021") are kept.
const PHONE_CANDIDATE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g

function redactContactDetails(text) {
  let emails = 0
  let phones = 0

  const withoutEmails = String(text || '').replace(EMAIL_PATTERN, () => {
    emails += 1
    return '[email removed]'
  })

  const redacted = withoutEmails.replace(PHONE_CANDIDATE_PATTERN, match => {
    const digits = match.replace(/\D/g, '').length
    if (digits < 9 || digits > 15) return match
    phones += 1
    return '[phone removed]'
  })

  return { text: redacted, emails, phones }
}

module.exports = { redactContactDetails }
