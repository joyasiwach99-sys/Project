import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const Ctx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );

  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const colors = { success: "text-success", error: "text-danger", info: "text-primary", warning: "text-warning" };

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end">
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} role="status" className="pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-pop">
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", colors[t.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[13px] text-fg-muted">{t.body}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="-m-1 rounded-md p-1 text-fg-subtle hover:text-fg">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

/** Wraps an async action with success/error toasts. Returns true on success. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async (fn: () => Promise<unknown>, success?: string, successBody?: string): Promise<boolean> => {
      try {
        await fn();
        if (success) toast({ tone: "success", title: success, body: successBody });
        return true;
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        toast({
          tone: "error",
          title: "That didn’t work",
          body: /permission|insufficient/i.test(msg) ? "Your role doesn’t allow this change." : msg,
        });
        return false;
      }
    },
    [toast],
  );
}
