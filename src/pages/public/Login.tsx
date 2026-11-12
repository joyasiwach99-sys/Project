import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { ArrowLeft, Eye, EyeOff, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { auth, REVIEWER_LOGIN } from "@/lib/firebase";
import { homeFor, useAuth } from "@/context/AuthContext";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { PublicHeader, useTitle } from "@/components/public/shared";
import { authErrorMessage } from "@/components/public/authErrors";

/** Where to send a signed-in user: their original destination if it fits their role, else their home. */
function destination(role: string | null, from: string | undefined): string {
  if (!role) return "/pending";
  const home = homeFor(role as Parameters<typeof homeFor>[0]);
  if (!from || from === "/login") return home;
  if (from.startsWith("/admin") && (role === "admin" || role === "viewer")) return from;
  if (from.startsWith("/driver") && (role === "driver" || role === "admin" || role === "viewer")) return from;
  return home;
}

export default function Login() {
  useTitle("Sign in");
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<"form" | "reviewer" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Redirect as soon as auth + profile are known.
  useEffect(() => {
    if (!loading && user) navigate(destination(role, from), { replace: true });
  }, [loading, user, role, from, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy("form");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(null);
    }
  };

  const reviewer = async () => {
    setReviewerError(null);
    setBusy("reviewer");
    try {
      await signInWithEmailAndPassword(auth, REVIEWER_LOGIN.email, REVIEWER_LOGIN.password);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setReviewerError(
        code === "auth/network-request-failed"
          ? authErrorMessage(err)
          : "The reviewer demo account isn’t available right now. Please try again later.",
      );
      setBusy(null);
    }
  };

  const reset = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email above, then choose “Forgot password?” again.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  };

  const signingIn = !!user && loading;

  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-md px-4 py-10 sm:py-14">
        <div className="text-center">
          <h1 className="text-[28px] font-semibold">Sign in</h1>
          <p className="mt-1.5 text-[15px] text-fg-muted">Operations console and driver app for SmartRoute Guardian.</p>
        </div>

        {signingIn && (
          <p className="mt-6 flex items-center justify-center gap-2 text-[14px] text-fg-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            Signing you in…
          </p>
        )}

        <Card className="mt-8 border-primary/30 bg-primary-soft/40 p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold">Explore as a reviewer</h2>
              <p className="mt-0.5 text-[14px] text-fg-muted">
                Open every dashboard with live data in read-only mode. No account needed — nothing you click can change the data.
              </p>
            </div>
          </div>
          <Button variant="navy" className="mt-4 w-full" icon={ShieldCheck} loading={busy === "reviewer"} disabled={busy === "form"} onClick={reviewer}>
            Explore the live demo (read-only)
          </Button>
          {reviewerError && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-danger">
              {reviewerError}
            </p>
          )}
        </Card>

        <div className="my-6 flex items-center gap-3 text-[13px] text-fg-subtle" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          or sign in with your account
          <span className="h-px flex-1 bg-border" />
        </div>

        <Card className="p-5 sm:p-6">
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label="Email" required>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              )}
            </Field>
            <Field label="Password" required>
              {(p) => (
                <div className="relative">
                  <Input
                    {...p}
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    aria-pressed={show}
                    className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-lg text-fg-muted hover:text-fg"
                  >
                    {show ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                  </button>
                </div>
              )}
            </Field>

            {error && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[14px] font-medium text-danger">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-[14px] font-medium text-success">
                {notice}
              </p>
            )}

            <Button type="submit" className="w-full" icon={LogIn} loading={busy === "form"} disabled={busy === "reviewer"}>
              Sign in
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
              <button type="button" onClick={reset} className="inline-flex min-h-[32px] items-center font-semibold text-primary hover:underline">
                Forgot password?
              </button>
              <span className="text-fg-muted">
                New driver?{" "}
                <Link to="/signup" className="font-semibold text-primary hover:underline">
                  Request access
                </Link>
              </span>
            </div>
          </form>
        </Card>

        <p className="mt-8 text-center">
          <Link to="/" className="inline-flex min-h-[40px] items-center gap-1.5 text-[14px] font-medium text-fg-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to the project website
          </Link>
        </p>
      </main>
    </div>
  );
}
