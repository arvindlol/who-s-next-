# Who's Next — Implementation Plan

Working plan for turning the merged `main` into one complete, working product.
Checkboxes track progress. Each phase ends with a verification gate; do not start
the next phase until the gate passes.

## Status (2026-11-13)

Code for phases 0–7 is written (see `CHANGELOG.md`). Verified on this machine: backend syntax (`node --check`), 26 backend and 13 frontend unit tests (all pass), and every relative import or export across the 42 frontend files resolves with exact filename case. Still open, and done by the user on a machine with dependencies and network:
- `npm install`, `npm run build`, `npm run lint` (ESLint config is in place but has not been run)
- Emulator end-to-end journey with `GEMINI_MOCK=true`, then one real Gemini run
- Firestore/Storage rules tests (not written yet; they need the emulator)
- Deployment, then run the migration script (written; dry run by default)
- Decided not to do: Google Fonts stay as they are, because testing happens on an internet-connected machine; emulator mode is optional through `VITE_USE_EMULATORS` rather than enforced.
## 0. Ground truth (from the analysis)

- `main` = merge of `piyush-dev` (HEAD) and `arvind-dev`. Reference snapshots:
  - `D:\Internship\who-s-next--main\who-s-next--piyush-dev` — older base + piyush's Candidates UI, `candidates.css` (26 KB), Reports page.
  - `D:\Internship\who-s-next--main\who-s-next--arvind-dev` — everything else (backend, screening, interviews) + simple Candidates page.
- Everything in `main` outside the conflicts equals arvind-dev (newer). Piyush-dev's other differing files are older — never copy them.
- Only things missing from `main`: piyush's stylesheet (add/add conflict on `pages/candidates.css`), clean `App.jsx`, clean `Candidates.jsx`.
- Agreed decision: **piyush's Candidates UI + backend-compatible resume storage + arvind's `?new`/`returnTo` handling + `skills` field.**

## Hard constraints for this machine

- **No external connections at all.** No git or GitHub, no npm registry, no Firebase or Google Cloud, no Gemini, no browsing to external sites. Anything external is requested from the user.
- No git: the safety net is a dated backup copy of the project folder before each phase, plus `CHANGELOG.md` (what changed, which files, why).
- No dependencies are installed (the local npm cache is missing about 110 frontend and 84 backend packages, so `npm ci --offline` fails). The user supplies them from an internet-connected Windows x64 machine (see "Offline dependency bundle").
- No Java on this machine. The Firestore and Storage emulators need a JDK; the Auth and Functions emulators don't.
- Running the frontend locally must not reach the live project: emulator-only mode (`VITE_USE_EMULATORS=true`, enforced) and Gemini mock mode. Google Fonts must be self-hosted or skipped locally, so the browser makes no external requests.

## Verification tiers (what can be tested with what)

| Tier | Needs | Verifies |
|---|---|---|
| T0 — now | Node 22 only | Backend syntax (`node --check`); unit tests of dependency-free logic with built-in `node:test` (validators, normalisers, crypto, CSV, status mapping, redaction) |
| T1 | Bundle part A (`node_modules`) | `vite build`, ESLint, frontend logic tests, functions loaded with the Firebase SDKs |
| T2 | Part A + B (JDK, firebase-tools, emulator JARs) | Full app on emulators + mock Gemini, rules tests, end-to-end journey |
| T3 — user, elsewhere | Real Firebase and a Gemini key | Real Gemini run, migration, deployment |

Design consequence: put pure logic in dependency-free modules (`functions/lib/*.js`, `frontend/src/utils/*.js`) so most of it is testable at T0.

## Guiding rules

1. One canonical data shape per collection; readers tolerate legacy shapes; a migration script converts old data.
2. Backend is the source of truth for anything AI-derived or security-relevant; the client never sets derived state.
3. Never break a working flow while fixing another: verify at the highest available tier after every phase.
4. Nothing is deployed from this machine. Deployment and live-data migration are done by the user elsewhere.
5. Keep changes reviewable: each phase is logged in `CHANGELOG.md` and preceded by a folder backup.

---

## Phase 0 — Safety net & tooling

- [x] Backup copy of the untouched project (local folder copy, user-approved), and start `CHANGELOG.md`.
- [x] Delete junk: `frontend/vite.config.js.timestamp-*.mjs`, empty root `package-lock.json`.
- [x] Add a test runner script using built-in `node --test` (no dependencies) for T0 tests.
- [x] Add Firebase Emulator config to `firebase.json` (auth, firestore, storage, functions; fixed local ports).
- [x] `frontend/src/firebase.js`: emulator mode via `VITE_USE_EMULATORS`; when local, refuse to start unless emulators are configured (no accidental live access).
- [ ] Self-host or locally skip Google Fonts (font files from the user, or system-font fallback).
- [x] Gemini **mock mode** in functions (`GEMINI_MOCK=true`, emulator only) returning fixture JSON; the real `fetch` to Gemini is impossible in mock mode.
- [ ] When the bundle arrives: place `node_modules`, record that the baseline build fails (conflict markers) — expected.

**Gate:** T0 runner works; with the bundle, dependencies resolve and (T2) emulators start.

---

## Phase 1 — Make it build and run (critical)

### 1.1 `frontend/src/App.jsx`
- [x] Take arvind's clean file; add piyush's `/reports` and `/interviews/:interviewId/reports/:candidateId` routes; keep the catch-all `*` → `/`; remove the duplicate `/candidates` route and import.

### 1.2 `frontend/src/pages/Candidates.jsx` (piyush base)
- [x] Remove the arvind half; keep piyush's half as the starting point.
- [x] **Resume storage contract** (canonical fields: `resumePath`, `resumeName`, `resumeUrl`):
  - Upload path `resumes/{uid}/{candidateId}-{timestamp}-{safeName}` (passes the backend prefix check; timestamp avoids overwrite on replace).
  - Legacy read: if only `resume` exists, derive `resumePath` from the download URL and use it as `resumeUrl`.
  - Replacing a resume deletes the old file using the *derived* path (fixes the orphan with legacy docs).
- [x] **Resumes: PDF only**, ≤ 10 MB (screening needs PDF).
- [x] **Skills**: add a comma/`·`-separated input, stored as `skills: string[]`; shown in table/profile; included in search.
- [x] **URL params**: `?new=true` opens the add modal; `returnTo` (only `/screening?…`) navigates back after save; `?candidateId=` opens that profile; clear params after use.
- [x] **Statuses**: one list; map legacy values case-insensitively (`Interview ready`→`Interview Ready`, `Selected`→`Hired`, `Dropped`→`Rejected`, `Resume reviewed`→`Resume Reviewed`, …); unknown values show as-is instead of the select silently showing the first option.
- [x] **Undo delete** restores the *original raw document* (all fields incl. `resume`, `skills`), not a rebuilt one.
- [x] **Email**: remove the silent `@gmail.com` auto-append on blur; keep the domain suggestions (pending decision D7).
- [x] Delete order: candidate doc first, then file (moves to the backend in Phase 3).

### 1.3 Styles
- [x] Copy piyush's `pages/candidates.css` → `frontend/src/pages/Candidates.css` (exact-case match with the import). Do not bring arvind's file.
- [x] Scope its global leaks: `.btn--danger*` → `.cand-panel/.cand-modal .btn--danger*`; mobile `.modal__actions` rules → `.cand-modal .modal__actions`.

### 1.4 Firestore rules
- [x] Add `match /candidates/{candidateId}/activity/{activityId}`: read if parent owner (`get`); create if parent owner (`getAfter`, for batches), `byUid == request.auth.uid`, allowed fields only; no update/delete (audit trail).

**Gate:** `vite build` passes; in emulators: sign up → add job (PDF) → add 2 candidates with PDFs → bulk stage change + feedback work (activity allowed) → screening (mock Gemini) lists those candidates and completes → plan generate/approve works.

---

## Phase 2 — Correctness & consistency

### 2.1 PDF-only everywhere
- [x] `services/jobs.js`: accept `.pdf` only; UI copy updated.
- [x] `storage.rules`: both paths require `contentType == 'application/pdf'`; resume filename must start with a candidate-ID-style prefix.
- [x] Existing non-PDF jobs: show "Re-upload as PDF" and disable "Select candidates".

### 2.2 One status vocabulary
- [x] `frontend/src/constants/statuses.js` for interview statuses (mirrors backend): `plan_needed`, `plan_ready`, `plan_approved`, `transcript_submitted`, `report_generating`, `report_ready`, `decided`.
- [x] `InterviewsPage`: map all of them (fixes `plan_approved` showing as step 1); correct action per step.
- [x] `services/dashboard.js`: "Interviews pending" = statuses before `decided` (not `scheduled`).
- [x] `services/homeJobs.js` + `services/jobs.js`: drop the `matches` collection; candidate count per job = unique `candidateIds` across that job's screening reports; activity = any report/interview for the job.

### 2.3 Auth
- [x] `Auth.jsx` uses `AuthProvider.signIn/signUp` (no direct Firebase calls).
- [x] `syncUserProfile` on auth change must not overwrite an existing name with the email prefix.
- [x] Fix "8+ characters" placeholder (min stays 6 unless decided otherwise); add "Forgot password?" (`sendPasswordResetEmail`).

### 2.4 Interview flow fixes
- [x] Review page: header/status reflect the real state (Draft vs Approved v N); hide Approve once approved; show "Continue to transcript".
- [x] `generateInterviewPlan`: refuse when approved unless `replaceApproved: true` (UI confirms); write inside a transaction with a `planVersion` precondition (no duplicate versions).
- [x] `startInterviewPlan`: if the interview exists and is still `plan_needed`/`plan_ready`, refresh `screeningReportId`/score from the newer screening.
- [x] Screening UI keys "already advanced" by `jobId+candidateId` (matches the backend ID), not by screening ID.

### 2.5 Errors & messages
- [x] `frontend/src/services/errors.js`: one mapper for callable errors; show the backend's safe message for `failed-precondition`/`internal`/`data-loss` instead of misleading generic text. Used by Screening, Interviews, Profile.

**Gate:** build passes; dashboard/Home counts correct in emulator; plan approve → regenerate behaves as designed.

---

## Phase 3 — Security & privacy

- [x] **Encryption key → Secret Manager** (`defineSecret('GEMINI_KEY_ENCRYPTION_KEY')`). New ciphertexts use `encryptionVersion: 2`. On read, v1 keys are decrypted with the old Firestore key and re-encrypted as v2. After migration, delete `systemSecrets/geminiEncryption`. *User action: set the secret.*
- [x] **App Check** (reCAPTCHA Enterprise) in the frontend; `enforceAppCheck: true` on callables (behind a param so the emulator still works). *User action: console setup.*
- [x] **Rate limits** per user per operation (Firestore counter, transactional): e.g. screening 20/hour, plan 30/hour, report 30/hour.
- [x] **Server-side deletes** (callables using the Admin SDK):
  - `deleteCandidate`: resume file(s), activity subcollection, candidate doc; related interviews/reports per decision D5.
  - `deleteJob`: JD file, job doc; related reports/interviews per D5. Replace the soft delete; the UI text matches the behaviour.
  - `deleteAccount`: all of the user's data + Auth user (Profile page "Delete account").
  - Undo for candidates: delay the server delete until the undo window ends (client calls `deleteCandidate` after 8 s, or soft-delete flag + scheduled cleanup).
- [x] **Firestore rules hardening**: field allowlists, types and size limits for `users`, `jobs`, `candidates`, `activity`; clients cannot set `status: 'ready'` on jobs without `storagePath` matching their path; `ownerId` immutable.
- [x] **Prompt-injection hardening**: move instructions to `systemInstruction`; label all document/user text as untrusted data; server-side validation stays authoritative.
- [x] **Diagnostics retention**: add `expireAt` (30 days) on `aiRequestDiagnostics`. *User action: enable the TTL policy.*
- [x] **Privacy notice** in Profile/Screening about candidate data going to Gemini under the recruiter's key (wording per D3).
- [x] *User action:* restrict the web API key to the hosting domains in GCP.

**Gate:** rules unit tests pass; old v1 keys still work and convert to v2; delete flows leave no files/docs behind (verified in the emulator).

---

## Phase 4 — AI pipeline reliability

- [x] Model IDs as function params (`defineString`) with one default; the same model is used and recorded everywhere.
- [x] `generationConfig.responseSchema` for screening, plan and final report.
- [x] **Normalise instead of reject** (screening): clamp components, `matchScore = sum`, derive `matchLevel`/`recommendation` from the score, rank by score (stable tie-break), compute summary counts and the best candidate server-side. Reject only on structural failures (missing/unknown candidate IDs, missing required text).
- [x] **Normalise the plan**: map topics case-insensitively; renumber questions; clamp minutes 2–5 and rebalance deterministically into the 90–95 % window; compute totals and coverage server-side. Reject only if a selected topic is uncovered or the question count is wrong after one retry.
- [x] **One automatic retry** on validation failure, with a short corrective note in the prompt.
- [x] **Large PDFs**: inline when the combined size is under the threshold (~15 MB), otherwise Gemini Files API (upload, reference, delete afterwards).
- [x] Pass the screening findings (matched/missing skills, concerns) into the interview-plan prompt (currently unused).
- [x] Screening allows **1–5 candidates** (per D6).
- [x] **Real progress**: create the `screeningReports` doc first with `status: 'running'` + `stage`, update stages as work proceeds, then mark `completed`/`failed`. The UI listens to the doc (survives a closed modal). Same pattern for plan and report generation.

**Gate:** fixture tests cover off-by-one sums, wrong labels, unsorted ranks and wrong totals — all normalised, not rejected; the mock flow completes end-to-end.

---

## Phase 5 — Complete the workflow (transcript → report → decision)

### Backend
- [x] `submitTranscript({ interviewId, transcript, speakerRoles, notes, redactContacts })`: requires `plan_approved`; size limit; server-side email/phone redaction when requested; stored under `interviews/{id}` (or a private subdoc); status → `transcript_submitted`.
- [x] `generateFinalReport({ interviewId })`: approved plan + answer guides + transcript → per-question score (1–5 or null when not asked) with evidence quotes, area scores, strengths/concerns with follow-up asks, advisory suggestion, evidence strength, plan coverage; normalised + validated; saved as `interviewReports/{interviewId}`; status → `report_ready`.
- [x] `saveHiringDecision({ interviewId, decision, reason })`: stores the decision with `decidedBy`/`decidedAt` and history; status → `decided`; updates the candidate's stage (offer → Hired, reject → Rejected, another → Interview Pending).
- [x] Rules: `interviewReports` readable by owner only; no client writes.

### Frontend
- [x] Transcript page loads the interview from Firestore (not sessionStorage); optional `.txt`/`.vtt` file import; real submit; the redaction checkbox is wired up.
- [x] Report page (`report.jsx`): keep the design, remove `DEFAULT_REPORT`, load the real report; the decision is saved via the callable (no localStorage); "Share" copies the link with a note that only the owner can open it.
- [x] `/reports` becomes a list of reports (filter by `?jobId=` from the Jobs page); a report detail route.
- [x] Plan editing before approval (per D8): edit wording/answer guide, remove/reorder → `updateInterviewPlan` bumps the version.

**Gate:** in the emulator the full journey works: job → candidates → screening → plan → approve → transcript → report → decision → candidate stage updated.

---

## Phase 6 — Code quality

- [x] Shared components: `AppLayout` (topbar + footer; used by all 10 pages), `PasswordInput`, `Modal`, `ScreeningReportView` (used by both screening pages).
- [x] Split `Candidates.jsx` (~2,650 lines): `hooks/useCandidates`, `CandidateTable`, `CandidateBoard`, `CandidateFormModal`, `CandidateProfileModal`, `utils/csv.js`, `utils/email.js`.
- [x] Split `functions/index.js`: `lib/gemini.js`, `lib/crypto.js`, `lib/validation.js`, `lib/rateLimit.js`, `screening.js`, `interviews.js`, `reports.js`, `account.js`.
- [x] Remove dead code (`data/screeningDemo.js`, unused imports, debug `console.info`).
- [x] Cheaper queries: `getCountFromServer` for dashboard stats; `limit()`/`orderBy` for "recent" lists.
- [ ] ESLint (+ react-hooks plugin) for both packages; `npm run lint` clean.
- [x] README: architecture, local setup with emulators, secrets, deploy steps. Remove "mock auth" text; fix the "Sift" footer.

**Gate:** lint clean, build passes, no behaviour change (repeat the Phase 5 journey).

---

## Phase 7 — Tests

- [x] Frontend unit tests (Vitest): CSV parse/export, candidate normalisation + legacy mapping, status mapping, error mapper.
- [x] Functions unit tests: screening/plan/report normalisers (fixtures), input validators, crypto v1→v2, redaction.
- [ ] Rules tests (`@firebase/rules-unit-testing`, emulator): owner-only access, activity rules, field validation, Storage PDF/size/path.
- [ ] Manual end-to-end checklist (emulator + mock Gemini), then one real-Gemini run with the user's key.

---

## Phase 8 — Migration & deployment (done by the user on another machine)

- [x] Relax the backend resume check to "path under `resumes/{uid}/` and referenced by this owner's candidate doc" so legacy files keep working without moving them.
- [ ] One-off admin script `functions/scripts/migrate-v2.js` (dry-run by default): candidate fields (`resumePath`/`resumeUrl`/`resumeName`, `skills[]`, statuses), interview statuses, jobs with non-PDF files flagged, v1 API keys re-encrypted.
- [ ] Deploy order: secrets → functions → rules (Firestore + Storage) → hosting; then run the migration; smoke test the live app.
- [x] Rollback note: keep the previous hosting release; rules and functions are redeployable from the baseline commit.

---

## Offline dependency bundle (prepared by the user on an internet-connected Windows x64 machine)

The OS and CPU must match this machine (Windows x64), because esbuild and rollup ship native binaries. Use Node 22.

**Part A: project dependencies (unlocks T1)**
1. Copy the project folder to the online machine.
2. `cd frontend` then `npm ci`; then `npm install -D eslint @eslint/js globals eslint-plugin-react-hooks eslint-plugin-react-refresh`.
3. `cd functions` then `npm ci`.
4. In the project root: `npm install -D firebase-tools @firebase/rules-unit-testing firebase@12` (this creates the root `package.json` and lockfile).
5. Bring back: `frontend/node_modules`, `functions/node_modules`, root `node_modules`, and every `package.json` and `package-lock.json` (frontend, functions, root).

**Part B: emulators (unlocks T2)**
6. On the online machine, from the project root: `npx firebase setup:emulators:firestore`, `npx firebase setup:emulators:storage`, `npx firebase setup:emulators:ui`.
7. Bring back the folder `%USERPROFILE%\.cache\firebase\emulators`; it goes to the same path on this machine.
8. A JDK 21 installer (for example Eclipse Temurin 21, Windows x64 MSI), installed on this machine by the user.
9. Optional: Manrope font files (`.woff2`, weights 400–800) for self-hosting; otherwise the system-font fallback is used locally.

Note: `firebase-tools` may try to check for updates or send usage statistics when it runs. Locally I'll run it with `--non-interactive`, statistics turned off, and update checks disabled. Any remaining network attempt simply fails offline; nothing depends on it.

## Decisions needed (defaults used if not answered)

| # | Decision | Default |
|---|---|---|
| D1 | Source control | **Decided:** no git on this machine; folder backups + `CHANGELOG.md` |
| D2 | Test environment | **Decided:** local only; T0 now, T1/T2 once the user supplies the bundle; mock Gemini |
| D3 | Gemini privacy | Notice + recommend a paid key; don't block free keys |
| D4 | Phase 5 (transcript/report) in this round | Yes |
| D5 | Deleting a candidate/job | Delete their interviews/reports and files (full erasure) |
| D6 | Screening size | 1–5 candidates |
| D7 | Email auto `@gmail.com` | Remove auto-append, keep suggestions |
| D8 | Edit questions before approval | Implement light editing |
| D9 | Console-side actions (Secret Manager, App Check, TTL, key restriction) | User does them; code supports both before and after |
