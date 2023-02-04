import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import admin from "firebase-admin";
import dotenv from "dotenv";
import { getAuth } from "firebase-admin/auth";

dotenv.config();

initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

export const db = getDatabase();
export const auth = getAuth();
