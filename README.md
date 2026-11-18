# Who's Next

AI-assisted interview preparation and candidate evaluation for recruiters. The recruiter stays in charge: the AI screens resumes, drafts structured interview plans and evaluates transcripts, while every decision is made and recorded by a person.

## Workflow

1. **Jobs** — upload a job description (PDF) with optional extra hiring criteria.
2. **Candidates** — add candidates with a PDF resume (one by one or CSV import), track their stage in a list or board view.
3. **Screening** — compare 1–5 resumes with a job description; Gemini scores, ranks and explains each fit.
4. **Interview plan** — advance a candidate; generate a timed, structured plan with answer guides; edit and approve it.
5. **Interview** — run it outside the app using the approved plan.
6. **Transcript** — paste or import (.txt/.vtt/.srt) the transcript; contact details are redacted by default.
7. **Final report** — Gemini scores each planned question against its answer guide with verified quotes; the recruiter records the decision (offer / another interview / do not progress), which also updates the candidate's stage.

## Architecture

| Part | Technology | Where |
|---|---|---|
| Web app | React 18 + Vite, React Router | `frontend/` |
| Auth | Firebase Authentication (email/password) | `frontend/src/auth.jsx` |
| Data | Cloud Firestore | rules: `firestore.rules`, indexes: `firestore.indexes.json` |
| Files | Cloud Storage (PDF only, ≤ 10 MB) | rules: `storage.rules` |
| Backend | Cloud Functions v2, Node 22, region `asia-south1` | `functions/` |
| AI | Google Gemini REST API, each user's own key | `functions/src/gemini/` |

### Backend layout (`functions/`)

```
index.js                  exports every function
src/config.js             models, limits, rate limits (overridable in functions/.env)
src/lib/                  pure logic, no Firebase imports — unit-tested
  screening.js plan.js report.js   normalise/repair Gemini output
  prompts.js              system instructions + JSON response schemas
  validation.js crypto.js redact.js rateLimit.js storagePaths.js statuses.js
src/gemini/               REST client (retries, Files API for large PDFs), mock responses
src/services/             Firestore/Storage helpers: keys, documents, deletion, rate limit
src/handlers/             callable functions
test/                     node:test unit tests
scripts/migrate-v2.js     one-off data migration
```

### Callable functions

| Function | Purpose |
|---|---|
| `validateGeminiKey` | status / validate / save / remove the user's Gemini key (encrypted) |
| `runScreening` | screen 1–5 candidates against a job; progress is written to the report document |
| `startInterviewPlan` | create (or reuse) the interview workspace for a screened candidate |
| `generateInterviewPlan` | generate a plan (locked against parallel runs, versioned) |
| `updateInterviewPlan` | save recruiter edits as a new plan version |
| `approveInterviewPlan` | approve a specific plan version |
| `submitTranscript` | store the transcript (optional contact redaction) |
| `generateFinalReport` | evaluate the transcript against the approved plan |
| `saveHiringDecision` | record the decision with history; updates the candidate stage |
| `deleteCandidate`, `deleteJob`, `deleteAccount` | full erasure of data and files |
| `purgeDeletedCandidates` | daily job finishing deletions left in the undo state |

### Data model (Firestore)

| Collection | Written by | Notes |
|---|---|---|
| `users/{uid}` | client | name, email |
| `jobs/{id}` | client | `storagePath` = `users/{uid}/jobs/{id}/{file}.pdf` |
| `candidates/{id}` | client | `resumePath` = `resumes/{uid}/{candidateId}-{timestamp}-{file}.pdf`, `skills[]`, `status` (stage) |
| `candidates/{id}/activity/{id}` | client + server | append-only timeline |
| `screeningReports/{id}` | server | `status` running/completed, ranked `results` |
| `interviews/{id}` | server | `status`: plan_needed → plan_ready → plan_approved → transcript_submitted → report_ready → decided |
| `interviewTranscripts/{interviewId}` | server | transcript, speaker roles, notes |
| `interviewReports/{interviewId}` | server | scores, evidence, decision + history |
| `userSecrets`, `systemSecrets`, `rateLimits`, `aiRequestDiagnostics` | server only | never readable by clients |

## Local development

Requirements: Node 22, Java 21 (for the Firestore/Storage emulators), Firebase CLI (`npm i -g firebase-tools`).

```bash
# install
cd frontend && npm install
cd ../functions && npm install

# unit tests (no emulators needed)
cd functions && npm test
cd ../frontend && npm test

# lint and build the web app
cd frontend && npm run lint && npm run build
```

### Running everything locally with fake Gemini

```bash
# functions/.env.local   (emulator only)
GEMINI_MOCK=true

# functions/.secret.local (emulator only — any base64 32-byte key)
GEMINI_KEY_ENCRYPTION_KEY=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">

firebase emulators:start                 # from the project root
cd frontend && npm run dev:emulators     # http://localhost:5173 against the emulators
```

With `GEMINI_MOCK=true` no request is sent to Gemini; any 20+ character string can be saved as the "API key". The mock responses deliberately contain wrong totals and unsorted ranks so the normalisers are exercised.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Gemini models | `functions/.env`: `GEMINI_SCREENING_MODEL`, `GEMINI_INTERVIEW_MODEL`, `GEMINI_REPORT_MODEL` | see `functions/.env.example` |
| App Check enforcement | `functions/.env`: `ENFORCE_APP_CHECK=true` + `frontend` `VITE_APPCHECK_SITE_KEY` | off |
| Encryption key for saved Gemini keys | Secret Manager: `GEMINI_KEY_ENCRYPTION_KEY` | required |
| Firebase project | `.firebaserc`, optional `VITE_FIREBASE_*` | `interview-assistant-9afd8` |

## Deployment (in this order)

1. **Secret** (once): `firebase functions:secrets:set GEMINI_KEY_ENCRYPTION_KEY` — paste a base64 32-byte key (command above). Keep it safe: losing it makes saved keys unreadable (users would re-enter them).
2. **Functions**: `firebase deploy --only functions`. The old `prepareScreening` function is replaced by `runScreening`; confirm its deletion when asked. The scheduled clean-up needs the Cloud Scheduler API (the CLI offers to enable it).
3. **Rules and indexes**: `firebase deploy --only firestore,storage`.
4. **Web app**: `cd frontend && npm run build`, then `firebase deploy --only hosting`.
5. **Migrate existing data**: see below.

### Data migration (once, after deploying)

```bash
cd functions
set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
node scripts/migrate-v2.js --project interview-assistant-9afd8            # dry run
node scripts/migrate-v2.js --project interview-assistant-9afd8 --apply    # write changes
```

It converts old candidate fields (resume URL → `resumePath`, skills text → list, stage spellings), old interview statuses, flags non-PDF jobs, and — if `GEMINI_KEY_ENCRYPTION_KEY` is set in the environment — re-encrypts saved Gemini keys with the new secret. After that, `systemSecrets/geminiEncryption` can be deleted.

### Recommended console settings

- **TTL policies** on `aiRequestDiagnostics.expireAt` and `rateLimits.expireAt`.
- **App Check** with reCAPTCHA Enterprise, then set `ENFORCE_APP_CHECK=true`.
- **Restrict the web API key** to your hosting domains (Google Cloud console → Credentials).

## Privacy

Resumes, job descriptions and transcripts are sent to Google Gemini with the recruiter's own key. On Gemini's free tier Google may use submitted content to improve its products, so a key from a billing-enabled project should be used for real candidate data. Transcripts have emails and phone numbers removed by default. Deleting a candidate, job or account removes the related files, screenings, interviews and reports.
