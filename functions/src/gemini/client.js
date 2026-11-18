'use strict'

const { GEMINI } = require('../config')
const { AppError } = require('../lib/appError')
const { readFailure, geminiError } = require('./errors')
const { extractJson } = require('./response')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function retryDelayMs(attempt) {
  const base = GEMINI.retryDelaysMs[attempt - 1] || 0
  return base ? base + Math.floor(Math.random() * 500) : 0
}

/**
 * Gemini REST client. Dependencies are injected so the module has no Firebase imports:
 *  - logger: { info, warn, error }
 *  - recordFailure: async (details) => diagnosticId | null
 *  - fetchImpl: defaults to global fetch
 */
function createGeminiClient({ logger, recordFailure, fetchImpl = globalThis.fetch }) {
  async function timedFetch(url, options, timeoutMs) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
  }

  /** POST generateContent with retries on transient failures. Returns the parsed JSON payload. */
  async function generateJson({
    apiKey,
    model,
    systemInstruction,
    parts,
    schema,
    operation,
    uid,
    context = {},
    requestMetadata = {},
  }) {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.2,
      },
    })
    const metadata = { ...requestMetadata, requestBodyBytes: Buffer.byteLength(body) }
    const attempts = []
    let failure = null

    for (let attempt = 1; attempt <= GEMINI.maxAttempts; attempt += 1) {
      const startedAt = Date.now()
      let response = null

      try {
        response = await timedFetch(
          `${GEMINI.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body },
          GEMINI.generationTimeoutMs,
        )
      } catch (error) {
        const timedOut = error?.name === 'AbortError'
        failure = {
          httpStatus: null,
          category: timedOut ? 'timeout' : 'network_error',
          safeMessage: timedOut ? 'The Gemini request exceeded the configured timeout.' : 'The Gemini request failed before receiving an HTTP response.',
        }
      }

      if (response?.ok) {
        attempts.push({ attempt, outcome: 'success', httpStatus: response.status, category: 'success', durationMs: Date.now() - startedAt })
        if (attempt > 1) logger.info('Gemini generation recovered after retry.', { uid, operation, model, attempt, ...context })

        let payload
        try {
          payload = await response.json()
        } catch {
          throw new AppError('data-loss', 'Gemini returned a response that could not be read.')
        }
        return extractJson(payload)
      }

      if (response) failure = await readFailure(response)
      const durationMs = Date.now() - startedAt
      attempts.push({ attempt, outcome: 'failed', httpStatus: failure?.httpStatus || null, category: failure?.category || 'unknown', durationMs })

      const retryable = failure?.httpStatus == null || GEMINI.retryableStatuses.has(failure.httpStatus)
      const delayMs = retryable && attempt < GEMINI.maxAttempts ? retryDelayMs(attempt) : 0

      logger.warn('Gemini generation attempt failed.', {
        uid, operation, model, attempt, maxAttempts: GEMINI.maxAttempts,
        httpStatus: failure?.httpStatus || null,
        providerStatus: failure?.providerStatus || null,
        providerReason: failure?.providerReason || null,
        category: failure?.category || 'unknown',
        safeMessage: failure?.safeMessage || null,
        durationMs, retrying: delayMs > 0, retryDelayMs: delayMs || null, ...context,
      })

      if (!delayMs) break
      await sleep(delayMs)
    }

    const diagnosticId = await recordFailure({ uid, operation, model, context, attempts, failure, requestMetadata: metadata })
    throw geminiError(failure, operation, attempts.length, diagnosticId)
  }

  /** Cheap authenticated call used to check that an API key works. */
  async function verifyKey(apiKey, uid) {
    let response
    try {
      response = await timedFetch(
        `${GEMINI.baseUrl}/v1beta/models?pageSize=1`,
        { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
        GEMINI.keyCheckTimeoutMs,
      )
    } catch (error) {
      logger.error('Gemini API-key validation request failed.', { uid, error: error?.name || 'UnknownError' })
      if (error?.name === 'AbortError') throw new AppError('deadline-exceeded', 'Gemini took too long to respond. Try again.')
      throw new AppError('unavailable', 'Gemini could not be reached. Check your connection and try again.')
    }

    if (!response.ok) {
      const failure = await readFailure(response)
      logger.warn('Gemini API-key validation failed.', { uid, httpStatus: failure.httpStatus, category: failure.category, safeMessage: failure.safeMessage })
      throw geminiError(failure, 'api_key_validation', 1)
    }
  }

  /** Uploads a PDF through the Files API (resumable protocol) and waits until it is ready. */
  async function uploadPdf({ apiKey, contents, displayName, uid }) {
    const start = await timedFetch(
      `${GEMINI.baseUrl}/upload/v1beta/files`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(contents.length),
          'X-Goog-Upload-Header-Content-Type': 'application/pdf',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
      },
      GEMINI.generationTimeoutMs,
    )
    if (!start.ok) throw geminiError(await readFailure(start), 'file_upload', 1)

    const uploadUrl = start.headers.get('x-goog-upload-url')
    if (!uploadUrl) throw new AppError('unavailable', 'Gemini did not accept the document upload. Please try again.')

    const upload = await timedFetch(
      uploadUrl,
      {
        method: 'POST',
        headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
        body: contents,
      },
      GEMINI.generationTimeoutMs,
    )
    if (!upload.ok) throw geminiError(await readFailure(upload), 'file_upload', 1)

    let file = (await upload.json())?.file
    const deadline = Date.now() + 90_000
    while (file?.state === 'PROCESSING' && Date.now() < deadline) {
      await sleep(2_000)
      const check = await timedFetch(
        `${GEMINI.baseUrl}/v1beta/${file.name}`,
        { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
        GEMINI.keyCheckTimeoutMs,
      )
      if (!check.ok) break
      file = await check.json()
    }

    if (!file?.uri || file.state === 'FAILED' || file.state === 'PROCESSING') {
      logger.warn('Gemini file upload did not become ready.', { uid, state: file?.state || 'unknown' })
      throw new AppError('unavailable', 'Gemini could not process one of the documents. Please try again.')
    }
    return { name: file.name, uri: file.uri }
  }

  /** Best-effort clean-up of uploaded files (they also expire automatically after 48 hours). */
  async function deleteFiles(apiKey, names) {
    await Promise.all(names.map(name => timedFetch(
      `${GEMINI.baseUrl}/v1beta/${name}`,
      { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } },
      GEMINI.keyCheckTimeoutMs,
    ).catch(() => null)))
  }

  /**
   * Turns PDFs into request parts: inline when small, otherwise via the Files API.
   * Returns { parts, cleanup } — always call cleanup() afterwards.
   */
  async function pdfParts({ apiKey, uid, documents }) {
    const totalBytes = documents.reduce((total, document) => total + document.contents.length, 0)

    if (totalBytes <= GEMINI.inlinePdfLimitBytes) {
      return {
        mode: 'inline',
        parts: documents.map(document => [
          { text: document.label },
          { inlineData: { mimeType: 'application/pdf', data: document.contents.toString('base64') } },
        ]).flat(),
        cleanup: async () => {},
      }
    }

    const uploaded = []
    try {
      for (const document of documents) {
        uploaded.push(await uploadPdf({ apiKey, contents: document.contents, displayName: document.label, uid }))
      }
    } catch (error) {
      await deleteFiles(apiKey, uploaded.map(file => file.name))
      throw error
    }

    return {
      mode: 'files_api',
      parts: documents.map((document, index) => [
        { text: document.label },
        { fileData: { mimeType: 'application/pdf', fileUri: uploaded[index].uri } },
      ]).flat(),
      cleanup: () => deleteFiles(apiKey, uploaded.map(file => file.name)),
    }
  }

  return { generateJson, verifyKey, pdfParts }
}

module.exports = { createGeminiClient }
