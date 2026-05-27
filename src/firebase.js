import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyAZ9wePxkcm6gtpJSPgaMzq_0XFP7-R-Bw",
  authDomain: "valo-bet-tracker.firebaseapp.com",
  projectId: "valo-bet-tracker",
  storageBucket: "valo-bet-tracker.firebasestorage.app",
  messagingSenderId: "894153241121",
  appId: "1:894153241121:web:0fe71b24c2f6bb9fbaa960"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
