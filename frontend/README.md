# Who’s Next — interview evaluation frontend

React + Vite frontend for the AI-assisted technical interview evaluation system.
Glass UI, mock login/signup, and a home workspace that mirrors the SRS pipeline.

## Run locally
    npm install
    npm run dev

## Deploy to Firebase Hosting
    npm install -g firebase-tools
    firebase login
    firebase use --add            # pick your Firebase project
    npm run build
    firebase deploy --only hosting

`firebase.json` is already set up (public dir = dist, SPA rewrite).

## Where things live
- `src/auth.jsx`      mock auth — replace signIn/signUp with Firebase Auth
- `src/pages/Auth.jsx` login + signup (routes /login, /signup)
- `src/pages/Home.jsx` post-login home (route /)
- `src/styles.css`    design tokens + glass system
