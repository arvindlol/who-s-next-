import { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase.js'

const AuthContext = createContext(null)
const cap = text => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '')

export const MIN_PASSWORD_LENGTH = 6

export function getAuthErrorMessage(err) {
  if (!err) return ''
  switch (err.code || '') {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password. Please check your credentials.'
    case 'auth/email-already-in-use':
      return 'An account already exists with this email address.'
    case 'auth/weak-password':
      return `Password should be at least ${MIN_PASSWORD_LENGTH} characters.`
    case 'auth/network-request-failed':
      return 'Network connection error. Please check your internet connection.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.'
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled for this project.'
    case 'auth/missing-email':
      return 'Enter your email address first.'
    default:
      return err.message?.replace(/^Firebase:\s*/i, '').replace(/\s*\(auth\/[^)]+\)\.?$/i, '')
        || 'Authentication failed. Please try again.'
  }
}

function emailPrefix(fbUser) {
  return fbUser?.email ? cap(fbUser.email.split('@')[0]) : 'User'
}

function formatUser(fbUser, nameOverride = '') {
  if (!fbUser) return null
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName: nameOverride || fbUser.displayName,
    name: nameOverride || fbUser.displayName || emailPrefix(fbUser),
    raw: fbUser,
  }
}

/**
 * Keeps users/{uid} in step with the Auth account. An existing name is never replaced by the
 * email prefix — only an explicit `nameOverride` (sign-up) changes it.
 */
async function syncUserProfile(fbUser, nameOverride = '') {
  if (!fbUser) return

  const ref = doc(db, 'users', fbUser.uid)
  const existing = await getDoc(ref)
  const storedName = existing.exists() ? existing.get('name') : ''
  const name = (nameOverride.trim() || storedName || fbUser.displayName || emailPrefix(fbUser)).slice(0, 100)

  const profile = { uid: fbUser.uid, name, email: fbUser.email, updatedAt: serverTimestamp() }
  if (!existing.exists()) profile.createdAt = serverTimestamp()

  await setDoc(ref, profile, { merge: true })
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, currentUser => {
      if (currentUser) {
        syncUserProfile(currentUser).catch(err => {
          console.error('Could not sync user profile:', err?.code || err)
        })
      }
      setUser(current => {
        // Keep a name set during sign-up even if Auth reports the user before updateProfile finishes.
        const keepName = current?.uid === currentUser?.uid ? current?.displayName : ''
        return formatUser(currentUser, currentUser?.displayName ? '' : keepName)
      })
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const signIn = async ({ email, password }) => {
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const formatted = formatUser(credential.user)
    setUser(formatted)
    return formatted
  }

  const signUp = async ({ email, password, name }) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password)
    const cleanName = name?.trim() || ''
    if (cleanName) {
      try {
        await updateProfile(credential.user, { displayName: cleanName })
      } catch (err) {
        console.warn('Could not set the display name:', err?.code || err)
      }
    }
    await syncUserProfile(credential.user, cleanName)
    const formatted = formatUser(credential.user, cleanName)
    setUser(formatted)
    return formatted
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUser(null)
  }

  const resetPassword = email => sendPasswordResetEmail(auth, email)

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, resetPassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
