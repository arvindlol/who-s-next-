'use strict'

/** Rounds to an integer and clamps into [min, max]; non-numbers become `fallback` (default: min). */
function clampInt(value, min, max, fallback = min) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

function average(values) {
  return values.length ? sum(values) / values.length : null
}

function roundTo(value, step) {
  return value == null ? null : Math.round(value / step) * step
}

module.exports = { clampInt, sum, average, roundTo }
