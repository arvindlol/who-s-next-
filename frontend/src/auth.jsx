import { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase.js'

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
const AuthContext = createContext(null)

export function getAuthErrorMessage(err) {
  if (!err) return ''
  const code = err.code || ''
  switch (code) {
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
      return 'Password should be at least 6 characters.'
    case 'auth/network-request-failed':
      return 'Network connection error. Please check your internet connection.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.'
    case 'auth/operation-not-allowed':
      return 'Email/password authentication is not enabled.'
    default:
      return (
        err.message?.replace(/^Firebase:\s*/i, '').replace(/\s*\(auth\/[^)]+\)\.?$/i, '') ||
        'Authentication failed. Please try again.'
      )
  }
}

function formatUser(fbUser) {
  if (!fbUser) return null
  const emailPrefix = fbUser.email ? cap(fbUser.email.split('@')[0]) : 'User'
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName: fbUser.displayName,
    name: fbUser.displayName || emailPrefix,
    raw: fbUser,
  }
}

async function syncUserProfile(fbUser, nameOverride = '') {
  if (!fbUser) return

  const userRef = doc(db, 'users', fbUser.uid)
  const existingUser = await getDoc(userRef)
  const emailPrefix = fbUser.email ? cap(fbUser.email.split('@')[0]) : 'User'
  const name = nameOverride.trim() || fbUser.displayName || emailPrefix
  const profile = {
    uid: fbUser.uid,
    name,
    email: fbUser.email,
    updatedAt: serverTimestamp(),
  }

  if (!existingUser.exists()) {
    profile.createdAt = serverTimestamp()
  }

  await setDoc(userRef, profile, { merge: true })
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, currentUser => {
      if (currentUser) {
        syncUserProfile(currentUser).catch(err => {
          console.error('Could not sync user profile to Firestore:', err)
        })
      }
      setUser(formatUser(currentUser))
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const signIn = async ({ email, password }) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    const formatted = formatUser(cred.user)
    setUser(formatted)
    return formatted
  }

  const signUp = async ({ email, password, name }) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (name?.trim()) {
      try {
        await updateProfile(cred.user, { displayName: name.trim() })
      } catch (err) {
        console.warn('Could not set displayName on user profile:', err)
      }
    }
    await syncUserProfile(cred.user, name)
    const formatted = formatUser({
      ...cred.user,
      displayName: name?.trim() || cred.user.displayName,
    })
    setUser(formatted)
    return formatted
  }

  const signOut = async () => {
    try {
      await fbSignOut(auth)
      setUser(null)
    } catch (err) {
      console.error('Sign out error:', err)
      throw err
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
