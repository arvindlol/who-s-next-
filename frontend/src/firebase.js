import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const env = import.meta.env

// The web config is public by design (security comes from Auth, App Check and the rules).
// Override any value with VITE_FIREBASE_* variables — see frontend/.env.example.
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyCdnoO0CFsPj1l77koa5rW1JrnO5UoprjA',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'interview-assistant-9afd8.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'interview-assistant-9afd8',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'interview-assistant-9afd8.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1033879546396',
  appId: env.VITE_FIREBASE_APP_ID || '1:1033879546396:web:a7b54169a88be4000b4dd9',
}

export const FUNCTIONS_REGION = 'asia-south1'
export const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true'

const app = initializeApp(firebaseConfig)

// App Check proves requests come from this web app. Enable it after creating a reCAPTCHA Enterprise
// key in the Firebase console, then set ENFORCE_APP_CHECK=true for the functions.
if (!USE_EMULATORS && env.VITE_APPCHECK_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, FUNCTIONS_REGION)

if (USE_EMULATORS) {
  const host = env.VITE_EMULATOR_HOST || '127.0.0.1'
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
  connectFunctionsEmulator(functions, host, 5001)
}
