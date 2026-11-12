import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Actor, Role, UserProfile } from "@/lib/types";

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  role: Role | null;
  isAdmin: boolean;
  isStaff: boolean;
  /** True when the signed-in role may change data (viewers are read-only). */
  canWrite: boolean;
  actor: Actor | null;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  /** uid whose profile snapshot has arrived — avoids a render where user is set but role isn't known yet. */
  const [profileFor, setProfileFor] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthLoading(false);
        if (!u) setProfile(null);
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    return onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        setProfile(snap.exists() ? ({ id: snap.id, ...snap.data() } as UserProfile) : null);
        setProfileFor(uid);
      },
      () => {
        setProfile(null);
        setProfileFor(uid);
      },
    );
  }, [user]);

  const value = useMemo<AuthState>(() => {
    const role = profile?.role ?? null;
    const isAdmin = role === "admin";
    return {
      user,
      profile,
      loading: authLoading || (!!user && profileFor !== user.uid),
      role,
      isAdmin,
      isStaff: role === "admin" || role === "viewer" || role === "driver",
      canWrite: role === "admin" || role === "driver",
      actor: profile
        ? { type: role === "driver" ? "driver" : "admin", id: profile.id, name: profile.name || profile.email }
        : null,
      signOut: () => fbSignOut(auth),
    };
  }, [user, profile, authLoading, profileFor]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export function homeFor(role: Role | null | undefined): string {
  if (role === "driver") return "/driver";
  if (role === "admin" || role === "viewer") return "/admin";
  if (role === "pending" || role === "device") return "/pending";
  return "/login";
}
