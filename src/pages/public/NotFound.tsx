import { Home, LogIn, PackageSearch, SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui/primitives";
import { PublicHeader, useTitle } from "@/components/public/shared";

export default function NotFound() {
  useTitle("Page not found");
  return (
    <div className="min-h-dvh bg-bg">
      <PublicHeader />
      <main id="main" className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-20 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
          <SearchX className="h-7 w-7" aria-hidden />
        </span>
        <p className="mt-6 font-mono text-[13px] font-semibold text-primary">404</p>
        <h1 className="mt-1 text-[28px] font-semibold">This page isn’t on the manifest</h1>
        <p className="mt-2 text-[15px] text-fg-muted">The link may be broken, or the page has moved.</p>
        <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <LinkButton to="/" icon={Home}>
            Go home
          </LinkButton>
          <LinkButton to="/track" variant="outline" icon={PackageSearch}>
            Track a parcel
          </LinkButton>
          <LinkButton to="/login" variant="ghost" icon={LogIn}>
            Sign in
          </LinkButton>
        </div>
      </main>
    </div>
  );
}
