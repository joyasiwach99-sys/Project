import { useEffect, useRef, useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { MessageSquare, Send } from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveQuery } from "@/hooks/useFirestore";
import type { Message } from "@/lib/types";
import { sendMessage } from "@/lib/actions";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { Button, EmptyState } from "../ui/primitives";
import { useAction } from "../ui/Toast";

const QUICK = ["Running 10 min late", "Customer not available", "Load verified, departing", "Need help with an alert"];

/** Dispatch ↔ driver conversation. One thread per driver (threadId = driver uid). */
export function ChatThread({ threadId, className, quickReplies = false }: { threadId: string; className?: string; quickReplies?: boolean }) {
  const { profile, canWrite } = useAuth();
  const { data: messages, loading } = useLiveQuery<Message>(
    query(collection(db, "messages"), where("threadId", "==", threadId), orderBy("createdAt", "asc"), limit(200)),
    `thread:${threadId}`,
  );
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const run = useAction();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length]);

  const send = async (body: string) => {
    if (!profile || !body.trim()) return;
    setSending(true);
    const ok = await run(() => sendMessage(threadId, body, { id: profile.id, name: profile.name, role: profile.role }));
    setSending(false);
    if (ok) setText("");
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-label="Messages">
        {!loading && messages.length === 0 && (
          <EmptyState icon={MessageSquare} title="No messages yet">
            Messages between dispatch and the driver appear here in real time.
          </EmptyState>
        )}
        {messages.map((m) => {
          const mine = m.fromId === profile?.id;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2", mine ? "rounded-br-md bg-primary text-primary-fg" : "rounded-bl-md bg-surface-2 text-fg")}>
                {!mine && <div className="mb-0.5 text-[12px] font-semibold text-primary">{m.fromName} · {m.fromRole === "driver" ? "Driver" : "Dispatch"}</div>}
                <p className="whitespace-pre-wrap text-[15px] leading-snug" style={{ overflowWrap: "anywhere" }}>{m.text}</p>
                <div className={cn("mt-1 text-right text-[11px]", mine ? "text-primary-fg/80" : "text-fg-subtle")}>{dateTime(m.createdAt, "sending…")}</div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {canWrite ? (
        <div className="border-t border-border p-3">
          {quickReplies && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {QUICK.map((q) => (
                <button key={q} onClick={() => send(q)} disabled={sending} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-fg-muted hover:bg-surface-2">
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <label htmlFor={`msg-${threadId}`} className="sr-only">
              Message
            </label>
            <input
              id={`msg-${threadId}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              placeholder="Type a message…"
              autoComplete="off"
              className="h-11 flex-1 rounded-lg border border-border bg-surface px-3 text-[15px] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button type="submit" icon={Send} loading={sending} disabled={!text.trim()} aria-label="Send message">
              <span className="hidden sm:inline">Send</span>
            </Button>
          </form>
        </div>
      ) : (
        <p className="border-t border-border p-3 text-center text-[13px] text-fg-muted">Read-only access — sending is disabled.</p>
      )}
    </div>
  );
}
