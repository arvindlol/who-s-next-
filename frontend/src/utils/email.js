export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com']

/** Trims and lower-cases an email. No domain is ever added silently. */
export function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, '')
}

/** Domain suggestions while typing ("rahul" → rahul@gmail.com …); the user picks one explicitly. */
export function getEmailSuggestions(value = '') {
  const text = normalizeEmail(value)
  if (!text) return []

  const atIndex = text.indexOf('@')
  const local = atIndex === -1 ? text : text.slice(0, atIndex)
  const typedDomain = atIndex === -1 ? '' : text.slice(atIndex + 1)
  if (!local || (typedDomain.includes('.') && EMAIL_PATTERN.test(text))) return []

  return EMAIL_DOMAINS
    .filter(domain => domain.startsWith(typedDomain) && domain !== typedDomain)
    .map(domain => ({ local, domain, value: `${local}@${domain}` }))
}

export function normalizePhone(value = '') {
  const text = String(value).trim()
  if (!text) return ''
  const digits = text.replace(/\D/g, '')
  return text.startsWith('+') ? `+${digits}` : digits
}

/** Last 10 digits, so "+91 98765 43210" and "98765 43210" count as the same number. */
export const phoneKey = (value = '') => String(value).replace(/\D/g, '').slice(-10)

export function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'there'
}

// One-click emails. They open in the recruiter's own mail app, pre-filled.
export const EMAIL_TEMPLATES = [
  {
    key: 'invite',
    label: 'Invite to interview',
    subject: candidate => `Interview invitation: ${candidate.role || 'your application'}`,
    body: (candidate, sender) =>
      `Hi ${firstName(candidate.name)},\n\nThank you for applying${candidate.role ? ` for the ${candidate.role} role` : ''}. We were impressed by your profile and would like to invite you for an interview.\n\nCould you please share your availability over the next few days?\n\nBest regards,\n${sender}`,
  },
  {
    key: 'info',
    label: 'Ask for details',
    subject: candidate => `A few details needed: ${candidate.role || 'your application'}`,
    body: (candidate, sender) =>
      `Hi ${firstName(candidate.name)},\n\nThank you for your interest${candidate.role ? ` in the ${candidate.role} role` : ''}. To move forward, could you please send us your updated resume and your current notice period?\n\nBest regards,\n${sender}`,
  },
  {
    key: 'reject',
    label: 'Polite rejection',
    subject: candidate => `Your application${candidate.role ? `: ${candidate.role}` : ''}`,
    body: (candidate, sender) =>
      `Hi ${firstName(candidate.name)},\n\nThank you for the time you put into applying${candidate.role ? ` for the ${candidate.role} role` : ''}. After careful consideration, we have decided to move forward with other candidates at this time.\n\nWe will keep your details on file and wish you every success ahead.\n\nBest regards,\n${sender}`,
  },
]

export function buildMailto(candidate, template, sender) {
  const subject = encodeURIComponent(template.subject(candidate))
  const body = encodeURIComponent(template.body(candidate, sender))
  return `mailto:${encodeURIComponent(candidate.email)}?subject=${subject}&body=${body}`
}
