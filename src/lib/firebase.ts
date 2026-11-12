import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

/**
 * Firebase web config for project `project-e0bb4` (web app "JOYA SIWACH").
 * Web API keys are not secrets — access is enforced by Auth + firestore.rules.
 * Any value can be overridden with a VITE_FIREBASE_* variable in .env.local.
 */
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "AIzaSyDhAYCN5CJ-GGVzdAl7dzp4LnIsn8rMEJM",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "project-e0bb4.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "project-e0bb4",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "project-e0bb4.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "206905527783",
  appId: env.VITE_FIREBASE_APP_ID ?? "1:206905527783:web:998074cff76dcca3cbc142",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-9YK0WR79VH",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/** `VITE_USE_EMULATORS=true npm run dev` talks to `firebase emulators:start` instead of production. */
export const usingEmulators = env.VITE_USE_EMULATORS === "true";

// Offline cache keeps the driver app usable in patchy mobile coverage.
export const db = (() => {
  if (usingEmulators) return initializeFirestore(app, {});
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return initializeFirestore(app, {});
  }
})();

if (usingEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

/** Read-only reviewer account (role "viewer" — firestore.rules deny every write). */
export const REVIEWER_LOGIN = { email: "reviewer@smartroute.demo", password: "Reviewer#2026" };
