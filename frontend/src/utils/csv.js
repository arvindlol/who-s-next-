/** Safe CSV cell: quotes the value and defuses spreadsheet formulas (=, +, -, @ …). */
export function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** CSV text with a BOM so Excel opens UTF-8 correctly. */
export function buildCsv(rows) {
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}

/** Small CSV reader that understands quotes, escaped quotes, commas and line breaks in cells. */
export function parseCsv(input) {
  const text = String(input || '').replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

/** Starts a browser download of a CSV file. */
export function downloadCsv(filename, rows) {
  const url = URL.createObjectURL(new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
