/**
 * One-time project setup for SmartRoute Guardian.
 *
 *   npx vite-node scripts/setup-demo.ts            # create/refresh demo accounts
 *   npx vite-node scripts/setup-demo.ts --seed     # …and (re)load the demo dataset
 *
 * Prerequisites (once):  firebase deploy --only auth,firestore:rules,firestore:indexes
 *
 * Accounts (email/password, Firebase Auth):
 *   admin@smartroute.demo          role admin   (bootstrap email allowed by firestore.rules)
 *   reviewer@smartroute.demo       role viewer  (password is public — read-only by rules)
 *   driver@smartroute.demo         role driver  → VAN-01
 *   device-van01..04@smartroute.demo  role device → VAN-0x / RDR-0x (for the Raspberry Pi gateways)
 *
 * Passwords come from env vars (SRG_ADMIN_PASSWORD, SRG_DRIVER_PASSWORD, SRG_DEVICE_PASSWORD)
 * or are generated once and stored in demo-accounts.local.json (git-ignored).
 * Uses the normal client SDK + security rules — no service-account key needed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, updateProfile, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import { resetDemoData, seedDemoData } from "../src/lib/seed";

const config = {
  apiKey: "AIzaSyDhAYCN5CJ-GGVzdAl7dzp4LnIsn8rMEJM",
  authDomain: "project-e0bb4.firebaseapp.com",
  projectId: "project-e0bb4",
  appId: "1:206905527783:web:998074cff76dcca3cbc142",
};

/** SRG_EMULATOR=1 → run against `firebase emulators:start` instead of production. */
const EMULATOR = process.env.SRG_EMULATOR === "1";
const SECRETS = EMULATOR ? "demo-accounts.emulator.local.json" : "demo-accounts.local.json";
const authFor = (app: FirebaseApp): Auth => {
  const a = getAuth(app);
  if (EMULATOR) connectAuthEmulator(a, "http://127.0.0.1:9099", { disableWarnings: true });
  return a;
};
const REVIEWER_PASSWORD = "Reviewer#2026"; // must match REVIEWER_LOGIN in src/lib/firebase.ts

type Secrets = Record<string, string>;
const secrets: Secrets = existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, "utf8")) : {};
const gen = () => `Srg-${randomBytes(9).toString("base64url")}`;
const pw = (key: string, env?: string) => (secrets[key] ??= env || gen());

const ACCOUNTS = [
  { key: "admin", email: "admin@smartroute.demo", name: "Joya Siwach (Admin)", role: "admin", password: pw("admin", process.env.SRG_ADMIN_PASSWORD) },
  { key: "reviewer", email: "reviewer@smartroute.demo", name: "Project Reviewer", role: "viewer", password: (secrets.reviewer = REVIEWER_PASSWORD) },
  { key: "driver", email: "driver@smartroute.demo", name: "Arjun Dahiya", role: "driver", vehicleId: "VAN-01", password: pw("driver", process.env.SRG_DRIVER_PASSWORD) },
  ...[1, 2, 3, 4].map((n) => ({
    key: `device-van0${n}`,
    email: `device-van0${n}@smartroute.demo`,
    name: `Gateway RDR-0${n}`,
    role: "device",
    vehicleId: `VAN-0${n}`,
    deviceId: `RDR-0${n}`,
    password: pw(`device-van0${n}`, process.env.SRG_DEVICE_PASSWORD),
  })),
] as const;

/** Signs in (or creates) an account in its own app instance so the admin session is untouched. */
async function ensureAccount(email: string, password: string, name: string): Promise<string> {
  const app: FirebaseApp = initializeApp(config, `acct-${email}`);
  const auth = authFor(app);
  try {
    try {
      return (await signInWithEmailAndPassword(auth, email, password)).user.uid;
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (!/user-not-found|invalid-credential|invalid-login-credentials/.test(code)) throw e;
      const cred = await createUserWithEmailAndPassword(auth, email, password).catch((err) => {
        if ((err as { code?: string }).code === "auth/email-already-in-use")
          throw new Error(`${email} exists with a different password. Put the right one in ${SECRETS} (or reset it in the Firebase console).`);
        throw err;
      });
      await updateProfile(cred.user, { displayName: name });
      console.log(`  created ${email}`);
      return cred.user.uid;
    }
  } finally {
    await deleteApp(app);
  }
}

async function main() {
  const seed = process.argv.includes("--seed");
  console.log("SmartRoute Guardian setup → project", config.projectId, EMULATOR ? "(LOCAL EMULATORS)" : "(PRODUCTION)");

  const uids: Record<string, string> = {};
  for (const a of ACCOUNTS) uids[a.key] = await ensureAccount(a.email, a.password, a.name);
  writeFileSync(SECRETS, JSON.stringify(secrets, null, 2) + "\n");

  const app = initializeApp(config);
  const auth = authFor(app);
  const db = getFirestore(app);
  if (EMULATOR) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const admin = ACCOUNTS[0];
  await signInWithEmailAndPassword(auth, admin.email, admin.password);
  const adminUid = uids.admin!;
  if (!(await getDoc(doc(db, "users", adminUid))).exists()) {
    await setDoc(doc(db, "users", adminUid), { name: admin.name, email: admin.email, role: "admin", active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    console.log("  bootstrapped admin profile");
  }
  for (const a of ACCOUNTS.slice(1)) {
    await setDoc(
      doc(db, "users", uids[a.key]!),
      {
        name: a.name,
        email: a.email,
        role: a.role,
        vehicleId: "vehicleId" in a ? a.vehicleId : null,
        deviceId: "deviceId" in a ? a.deviceId : null,
        active: true,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
  }
  console.log(`  ${ACCOUNTS.length} accounts ready (passwords in ${SECRETS})`);

  if (seed) {
    const actor = { type: "admin" as const, id: adminUid, name: admin.name };
    process.stdout.write("  clearing old data… ");
    const deleted = await resetDemoData(db);
    console.log(`${deleted} docs`);
    process.stdout.write("  writing demo dataset… ");
    const { docs } = await seedDemoData(db, { actor, driverUid: uids.driver! });
    console.log(`${docs} docs`);
    // Re-assert gateway accounts' vehicle links after the reset.
    for (const a of ACCOUNTS.filter((x) => x.role === "device")) {
      await setDoc(doc(db, "users", uids[a.key]!), { vehicleId: a.vehicleId, deviceId: a.deviceId }, { merge: true });
    }
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nSetup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
