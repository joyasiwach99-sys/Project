import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ArrowLeft, Eye, EyeOff, Info, UserPlus } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { homeFor, useAuth } from "@/context/AuthContext";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { PublicHeader, useTitle } from "@/components/public/shared";
import { authErrorMessage } from "@/components/public/authErrors";

type Errors = Partial<Record<"name" | "email" | "phone" | "password" | "confirm", string>>;

function validate(v: { name: string; email: string; phone: string; password: string; confirm: string }): Errors {
  const e: Errors = {};
  if (v.name.trim().length < 2) e.name = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Enter a valid email address, like name@example.com.";
  if (v.phone.trim() && !/^[+\d][\d\s-]{6,17}$/.test(v.phone.trim())) e.phone = "Enter a phone number with digits only, e.g. +91 98765 43210.";
  if (v.password.length < 8) e.password = "Use at least 8 characters.";
  if (v.confirm !== v.password) e.confirm = "Passwords don’t match.";
  return e;
}

export default function Signup() {
  useTitle("Request access");
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Already signed in (and not in the middle of creating this account) → go home.
  useEffect(() => {
    if (!busy && !loading && user) navigate(role ? homeFor(role) : "/pending", { replace: true });
  }, [busy, loading, user, role, navigate]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k: keyof Errors) => () => {
    if (!form[k]) return;
    const next = validate(form);
    setErrors((prev) => ({ ...prev, [k]: next[k] }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const found = validate(form);
    setErrors(found);
    const firstBad = (["name", "email", "phone", "password", "confirm"] as const).find((k) => found[k]);
    if (firstBad) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstBad}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password);
      const name = form.name.trim();
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        email: cred.user.email,
        phone: form.phone.trim() || null,
        role: "pending",
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate("/pending", { replace: true });
    } catch (err) {
      setSubmitError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-md px-4 py-10 sm:py-14">
        <div className="text-center">
          <h1 className="text-[28px] font-semibold">Request access</h1>
          <p className="mt-1.5 text-[15px] text-fg-muted">For drivers and operations staff joining the pilot.</p>
        </div>

        <div className="mt-6 flex gap-3 rounded-xl border border-primary/25 bg-primary-soft/50 p-4 text-[14px]">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <p className="text-fg-muted">
            After you sign up, an admin reviews your request. Drivers are then assigned to a vehicle; you’ll see your route as soon as you’re approved.
          </p>
        </div>

        <Card className="mt-6 p-5 sm:p-6">
          <form ref={formRef} onSubmit={submit} noValidate className="space-y-4">
            <Field label="Full name" required error={errors.name}>
              {(p) => <Input {...p} name="name" autoComplete="name" value={form.name} onChange={set("name")} onBlur={blur("name")} />}
            </Field>
            <Field label="Email" required error={errors.email}>
              {(p) => (
                <Input {...p} name="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set("email")} onBlur={blur("email")} />
              )}
            </Field>
            <Field label="Phone" help="Optional — lets dispatch reach you on the road." error={errors.phone}>
              {(p) => <Input {...p} name="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} onBlur={blur("phone")} />}
            </Field>
            <Field label="Password" required help="At least 8 characters." error={errors.password}>
              {(p) => (
                <div className="relative">
                  <Input
                    {...p}
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={set("password")}
                    onBlur={blur("password")}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide passwords" : "Show passwords"}
                    aria-pressed={show}
                    className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-lg text-fg-muted hover:text-fg"
                  >
                    {show ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                  </button>
                </div>
              )}
            </Field>
            <Field label="Confirm password" required error={errors.confirm}>
              {(p) => (
                <Input
                  {...p}
                  name="confirm"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={set("confirm")}
                  onBlur={blur("confirm")}
                />
              )}
            </Field>

            {submitError && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[14px] font-medium text-danger">
                {submitError}
              </p>
            )}

            <Button type="submit" className="w-full" icon={UserPlus} loading={busy}>
              Create account
            </Button>
            <p className="text-center text-[14px] text-fg-muted">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Sign in
              </Link>
            </p>
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
