// Firebase SDK modular. Cada usuario accede únicamente a documentos permitidos por firestore.rules.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, onSnapshot, query, where, serverTimestamp, runTransaction, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const app = initializeApp(window.TIMECORE_FIREBASE_CONFIG);
const auth = getAuth(app), db = getFirestore(app);
window.TC = { app, auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, initializeApp, deleteApp, getAuth, collection, doc, setDoc, getDoc, getDocs, onSnapshot, query, where, serverTimestamp, runTransaction, deleteDoc };
window.dispatchEvent(new Event('tc-ready'));
