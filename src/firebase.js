import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { enableIndexedDbPersistence, getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD7FAK1PPLARfNr3GS8t1nTjXCyhHHqteM",
  authDomain: "warkout-tracker.firebaseapp.com",
  projectId: "warkout-tracker",
  storageBucket: "warkout-tracker.firebasestorage.app",
  messagingSenderId: "226692133374",
  appId: "1:226692133374:web:89fd1a144509dc9d3110af",
  measurementId: "G-FXQCR4HC67",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

enableIndexedDbPersistence(db).catch(() => {});

export function ensureAnonymousUser(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      callback(user);
      return;
    }

    const credential = await signInAnonymously(auth);
    callback(credential.user);
  });
}
