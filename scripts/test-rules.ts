/**
 * Security-rules checks against the local emulators (needs the demo accounts + dataset):
 *
 *   firebase emulators:start --only auth,firestore
 *   SRG_EMULATOR=1 npx vite-node scripts/setup-demo.ts --seed
 *   npx vite-node scripts/test-rules.ts
 *
 * Each case signs in as a role and asserts the write/read is allowed or denied.
 */
import { readFileSync } from "node:fs";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  where,
  Timestamp,
  type Firestore,
} from "firebase/firestore";

setLogLevel("silent");
const pw = JSON.parse(readFileSync("demo-accounts.emulator.local.json", "utf8")) as Record<string, string>;
const config = { apiKey: "emulator", projectId: "project-e0bb4", appId: "emulator" };

async function as(email: string | null, password?: string): Promise<{ db: Firestore; uid: string | null; done: () => Promise<void> }> {
  const app = initializeApp(config, `t-${email}-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  let uid: string | null = null;
  if (email) {
    try {
      uid = (await signInWithEmailAndPassword(auth, email, password!)).user.uid;
    } catch {
      uid = (await createUserWithEmailAndPassword(auth, email, password!)).user.uid;
    }
  }
  return { db, uid, done: () => deleteApp(app) };
}

let pass = 0;
let fail = 0;
async function expect(label: string, shouldSucceed: boolean, fn: () => Promise<unknown>) {
  let ok = true;
  try {
    await fn();
  } catch {
    ok = false;
  }
  const good = ok === shouldSucceed;
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${shouldSucceed ? "allow" : "deny "}  ${label}${good ? "" : `  (got ${ok ? "allowed" : "denied"})`}`);
}

const event = (actor: { type: string; id: string }, vehicleId: string, stamped = true) => ({
  type: "note",
  message: "rules test",
  actor: { ...actor, name: "test" },
  vehicleId,
  createdAt: stamped ? serverTimestamp() : Timestamp.fromMillis(Date.now() - 3600e3),
});

async function main() {
  const admin = await as("admin@smartroute.demo", pw.admin);
  const anyParcel = (await getDocs(query(collection(admin.db, "parcels"), where("vehicleId", "==", "VAN-01"), limit(1)))).docs[0]!;
  const otherParcel = (await getDocs(query(collection(admin.db, "parcels"), where("vehicleId", "==", "VAN-02"), limit(1)))).docs[0]!;
  const anEvent = (await getDocs(query(collection(admin.db, "events"), limit(1)))).docs[0]!;
  const trackingId = anyParcel.get("trackingId") as string;

  // --- anonymous public
  const anon = await as(null);
  await expect("public can GET a tracking page", true, () => getDoc(doc(anon.db, "publicTracking", trackingId)));
  await expect("public cannot LIST tracking pages", false, () => getDocs(query(collection(anon.db, "publicTracking"), limit(1))));
  await expect("public cannot read parcels", false, () => getDoc(doc(anon.db, "parcels", anyParcel.id)));

  // --- pending sign-up
  const pendingEmail = `pending-${Date.now()}@example.com`;
  const pending = await as(pendingEmail, "Pending#12345");
  await expect("new user cannot sign up straight into admin", false, () => setDoc(doc(pending.db, "users", pending.uid!), { name: "New Person", email: pendingEmail, role: "admin" }));
  await expect("new user can create own profile as pending", true, () => setDoc(doc(pending.db, "users", pending.uid!), { name: "New Person", email: pendingEmail, role: "pending" }));
  await expect("new user cannot self-promote to admin", false, () => updateDoc(doc(pending.db, "users", pending.uid!), { role: "admin" }));
  await expect("pending user cannot read vehicles", false, () => getDocs(collection(pending.db, "vehicles")));

  // --- reviewer (viewer)
  const viewer = await as("reviewer@smartroute.demo", pw.reviewer);
  await expect("viewer can read vehicles", true, () => getDocs(collection(viewer.db, "vehicles")));
  await expect("viewer cannot update a parcel", false, () => updateDoc(doc(viewer.db, "parcels", anyParcel.id), { status: "delivered" }));
  await expect("viewer cannot create an alert", false, () => setDoc(doc(collection(viewer.db, "alerts")), { status: "open", vehicleId: "VAN-01", createdAt: serverTimestamp() }));

  // --- driver (VAN-01)
  const driver = await as("driver@smartroute.demo", pw.driver);
  await expect("driver can mark own parcel delivered", true, () => updateDoc(doc(driver.db, "parcels", anyParcel.id), { status: anyParcel.get("status"), updatedAt: serverTimestamp() }));
  await expect("driver cannot touch another vehicle's parcel", false, () => updateDoc(doc(driver.db, "parcels", otherParcel.id), { status: "delivered" }));
  await expect("driver cannot reassign a parcel's vehicle", false, () => updateDoc(doc(driver.db, "parcels", anyParcel.id), { vehicleId: "VAN-02" }));
  await expect("driver can log a server-stamped event as self", true, () => setDoc(doc(collection(driver.db, "events")), event({ type: "driver", id: driver.uid! }, "VAN-01")));
  await expect("driver cannot backdate an event", false, () => setDoc(doc(collection(driver.db, "events")), event({ type: "driver", id: driver.uid! }, "VAN-01", false)));
  await expect("driver cannot impersonate a device in the audit trail", false, () => setDoc(doc(collection(driver.db, "events")), event({ type: "device", id: "RDR-01" }, "VAN-01")));
  await expect("driver can advance a tracking timeline", true, () => updateDoc(doc(driver.db, "publicTracking", trackingId), { updatedAt: serverTimestamp() }));
  await expect("driver cannot edit customer details on tracking", false, () => updateDoc(doc(driver.db, "publicTracking", trackingId), { area: "Elsewhere" }));
  await expect("driver cannot change own role", false, () => updateDoc(doc(driver.db, "users", driver.uid!), { role: "admin" }));
  await expect("driver can update own phone", true, () => updateDoc(doc(driver.db, "users", driver.uid!), { phone: "+91 90000 00000", updatedAt: serverTimestamp() }));

  // --- device (RFID gateway in VAN-01)
  const device = await as("device-van01@smartroute.demo", pw["device-van01"]);
  await expect("gateway can publish presence for its vehicle", true, () => updateDoc(doc(device.db, "vehicles", "VAN-01"), { presentEpcs: [], presentCount: 0, lastScanAt: serverTimestamp(), readerOnline: true, updatedAt: serverTimestamp() }));
  await expect("gateway cannot publish presence for another vehicle", false, () => updateDoc(doc(device.db, "vehicles", "VAN-02"), { presentEpcs: [] }));
  await expect("gateway can claim a foreign parcel it physically sees", true, () => updateDoc(doc(device.db, "parcels", otherParcel.id), { inVehicleId: "VAN-01", lastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await expect("gateway cannot change a foreign parcel's status", false, () => updateDoc(doc(device.db, "parcels", otherParcel.id), { status: "exception" }));
  await expect("gateway can raise an alert for its vehicle", true, () => setDoc(doc(collection(device.db, "alerts")), { type: "unknown_tag", severity: "info", status: "open", title: "t", message: "t", vehicleId: "VAN-01", source: "device", detectedAt: serverTimestamp(), createdAt: serverTimestamp() }));
  await expect("gateway cannot raise an alert for another vehicle", false, () => setDoc(doc(collection(device.db, "alerts")), { status: "open", vehicleId: "VAN-02", createdAt: serverTimestamp() }));
  await expect("gateway can heartbeat its own reader doc", true, () => updateDoc(doc(device.db, "devices", "RDR-01"), { lastHeartbeat: serverTimestamp(), stats: { readsPerMin: 1 }, updatedAt: serverTimestamp() }));
  await expect("gateway cannot heartbeat another reader", false, () => updateDoc(doc(device.db, "devices", "RDR-02"), { lastHeartbeat: serverTimestamp() }));

  // --- audit trail immutability (even for admin)
  await expect("nobody can edit an audit event (admin)", false, () => updateDoc(doc(admin.db, "events", anEvent.id), { message: "tampered" }));
  await expect("admin cannot forge a non-demo driver message", false, () => setDoc(doc(collection(admin.db, "messages")), { threadId: driver.uid, fromId: driver.uid, fromName: "x", fromRole: "driver", text: "forged", createdAt: serverTimestamp() }));

  // restore the parcel claimed above
  await updateDoc(doc(admin.db, "parcels", otherParcel.id), { inVehicleId: otherParcel.get("inVehicleId") ?? null });
  for (const c of [admin, anon, pending, viewer, driver, device]) await c.done();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
