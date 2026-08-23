import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

/**
 * Public Client-Side Firebase Configuration
 * Note: Only public client identifiers are stored here.
 * Server credentials, admin keys, and SMTP credentials must never be in frontend code.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyCChxWVg-w1TiertkXlUrfUgcC19y-CPNw",
  authDomain: "hiiii-72d78.firebaseapp.com",
  databaseURL: "https://hiiii-72d78-default-rtdb.firebaseio.com",
  projectId: "hiiii-72d78",
  storageBucket: "hiiii-72d78.firebasestorage.app",
  messagingSenderId: "560685164053",
  appId: "1:560685164053:web:7f672f7503160ec868901c"
};

// Initialize Firebase client instance if needed
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const database = getDatabase(app);
