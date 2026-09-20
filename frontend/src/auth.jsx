{/*import { createContext, useContext, useState } from 'react'

// Mock auth. Swap the two functions below for Firebase Auth later:
//   signInWithEmailAndPassword / createUserWithEmailAndPassword
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)

  const signIn = async ({ email }) => {
    await new Promise(r => setTimeout(r, 500))
    setUser({ email, name: cap(email.split('@')[0]) })
  }
  const signUp = async ({ email, name }) => {
    await new Promise(r => setTimeout(r, 500))
    setUser({ email, name: name || cap(email.split('@')[0]) })
  }
  const signOut = () => setUser(null)

  return <AuthContext.Provider value={{ user, signIn, signUp, signOut }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)*/}




import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const signIn = async ({ email, password }) => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    setUser({
      email: email,
      name: email.split("@")[0],
    });
  };

  const signUp = async ({ email, password, name }) => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    setUser({
      email: email,
      name: name || email.split("@")[0],
    });
  };

  const signOut = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}