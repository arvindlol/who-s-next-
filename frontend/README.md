# Who's Next — web app

React 18 + Vite front end. See the [project README](../README.md) for the architecture, backend and deployment.

```bash
npm install
npm run dev              # against the Firebase project in src/firebase.js
npm run dev:emulators    # against local emulators (see project README)
npm test                 # unit tests for utils (Node's built-in test runner)
npm run lint
npm run build
```

## Structure

```
src/
  App.jsx                routes (pages are lazy-loaded)
  auth.jsx               Firebase Auth context (sign in/up, reset password, profile sync)
  firebase.js            Firebase init, optional emulators and App Check
  components/            AppLayout (top bar + footer), PasswordInput, ScreeningReportView, Brand
  constants/statuses.js  candidate stages and interview statuses (mirrors the backend)
  services/              Firestore/Storage access and callable wrappers (api.js)
  utils/                 pure helpers: candidate model, CSV, email, transcript, formatting
  hooks/                 useToasts
  pages/                 one file per route; pages/candidates/ holds the Candidates page parts
```
