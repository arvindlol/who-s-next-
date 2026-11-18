'use strict'

/** Trim, collapse whitespace and cap the length of a value; returns '' for non-strings. */
function cleanText(value, maxLength = 500) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

/** Same as cleanText but keeps line breaks (for multi-line text such as transcripts). */
function cleanMultilineText(value, maxLength = 10_000) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
}

/** Case-insensitive de-duplicated list of cleaned strings (nested arrays are flattened). */
function uniqueTextItems(values, maximum = 8, itemMaxLength = 180) {
  const seen = new Set()
  const items = []
  const list = Array.isArray(values) ? values.flat(Infinity) : []

  for (const value of list) {
    const text = cleanText(typeof value === 'object' && value ? value.text : value, itemMaxLength)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    items.push(text)
    if (items.length >= maximum) break
  }

  return items
}

/** List of cleaned strings from an unknown value (non-arrays give an empty list). */
function textList(value, maximum = 12, itemMaxLength = 300) {
  return uniqueTextItems(Array.isArray(value) ? value : [], maximum, itemMaxLength)
}

/** Lower-case words of a string, for fuzzy comparisons. */
function words(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter(word => word.length > 1)
}

/** Normalised form used to check that a quote really appears in a transcript. */
function comparableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
}

module.exports = { cleanText, cleanMultilineText, uniqueTextItems, textList, words, comparableText }
