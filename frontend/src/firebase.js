import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyCdnoO0CFsPj1l77koa5rW1JrnO5UoprjA",
    authDomain: "interview-assistant-9afd8.firebaseapp.com",
    projectId: "interview-assistant-9afd8",
    storageBucket: "interview-assistant-9afd8.firebasestorage.app",
    messagingSenderId: "1033879546396",
    appId: "1:1033879546396:web:a7b54169a88be4000b4dd9",
    measurementId: "G-9PG8GLSKS5"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
