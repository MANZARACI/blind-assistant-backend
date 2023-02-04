import { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebase.js";

export const seedLocations = (location) => {
  const locationsRef = db.ref("devices/" + 122115);
  location.time = Timestamp.now();
  locationsRef.push(location);
};
