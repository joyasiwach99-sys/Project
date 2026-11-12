import { useState } from "react";
import { Link } from "react-router-dom";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ArrowRight, CheckCircle2, Clock, Cpu, Loader2, LogIn, LogOut, UserCheck } from "lucide-react";
import { db } from "@/lib/firebase";
import { homeFor, useAuth } from "@/context/AuthContext";
import { Button, Card, LinkButton } from "@/components/ui/primitives";
import { PublicHeader, useTitle } from "@/components/public/shared";
import { authErrorMessage } from "@/components/public/authErrors";

export default function Pending() {
  useTitle("Account status");
  const { user, profile, role, loading, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completeRegistration = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await setDoc(doc(db, "users", user.uid), {
        name: user.displayName || user.email?.split("@")[0] || "New user",
        email: user.email,
        phone: null,
        role: "pending",
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(/permission/i.test(String(e)) ? "We couldn’t save your profile. Please sign out and try again." : authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex items-center justify-center gap-3 py-6 text-fg-muted" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        Checking your account…
      </div>
    );
  } else if (!user) {
    body = (
      <Status icon={LogIn} tone="neutral" title="You’re signed out" text="Sign in to see the status of your account.">
        <LinkButton to="/login" icon={LogIn} className="w-full sm:w-auto">
          Sign in
        </LinkButton>
      </Status>
    );
  } else if (!profile) {
    body = (
      <Status icon={UserCheck} tone="primary" title="Finish setting up your account" text="Your sign-in was created, but your profile wasn’t saved. Complete registration to send your request to an admin.">
        <Button onClick={completeRegistration} loading={busy} icon={UserCheck} className="w-full sm:w-auto">
          Complete registration
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}
      </Status>
    );
  } else if (role === "pending") {
    body = (
      <Status
        icon={Clock}
        tone="warning"
        title="Waiting for approval"
        text={`Thanks, ${profile.name.split(" ")[0]}. An admin needs to approve your account before you can use the dashboards. Drivers are assigned a vehicle at the same time. This page updates by itself — no need to refresh.`}
      >
        <p className="flex items-center gap-2 text-[13px] text-fg-muted" role="status">
          <span className="relative inline-flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-orange" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-orange" />
          </span>
          Listening for approval as {profile.email}
        </p>
      </Status>
    );
  } else if (role === "device") {
    body = (
      <Status
        icon={Cpu}
        tone="neutral"
        title="This is a device account"
        text="Device accounts are used by the Raspberry Pi RFID gateway inside a vehicle to report scans. They can’t open the web dashboards. Sign in with a personal account instead."
      />
    );
  } else {
    body = (
      <Status icon={CheckCircle2} tone="success" title="You’re approved" text={`Your account is active with the ${role} role.`}>
        <LinkButton to={homeFor(role)} className="w-full sm:w-auto">
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden />
        </LinkButton>
      </Status>
    );
  }

  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-lg px-4 py-12 sm:py-16">
        <h1 className="sr-only">Account status</h1>
        <Card className="p-6 sm:p-8">{body}</Card>
        {user && (
          <div className="mt-6 flex justify-center">
            <Button variant="ghost" icon={LogOut} onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        )}
        <p className="mt-4 text-center text-[14px]">
          <Link to="/" className="font-medium text-fg-muted hover:text-fg">
            Back to the project website
          </Link>
        </p>
      </main>
    </div>
  );
}

function Status({
  icon: Icon,
  tone,
  title,
  text,
  children,
}: {
  icon: typeof Clock;
  tone: "neutral" | "primary" | "warning" | "success";
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-2 text-fg-muted",
    primary: "bg-primary-soft text-primary",
    warning: "bg-warning-soft text-warning",
    success: "bg-success-soft text-success",
  };
  return (
    <div className="text-center sm:text-left">
      <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${tones[tone]}`}>
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-[22px] font-semibold">{title}</h2>
      <p className="mt-2 text-[15px] text-fg-muted">{text}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
