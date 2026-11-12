import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useOps } from "@/context/OpsData";
import { cn } from "@/lib/utils";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ChatThread } from "@/components/messages/ChatThread";

export default function AdminMessages() {
  useEffect(() => {
    document.title = "Messages · SmartRoute Guardian";
  }, []);
  const { users, vehicles } = useOps();
  const drivers = users.filter((u) => u.role === "driver").sort((a, b) => a.name.localeCompare(b.name));
  const [threadId, setThreadId] = useState<string>("");
  const active = drivers.find((d) => d.id === threadId) ?? drivers[0];

  return (
    <>
      <PageHeader title="Messages" description="Dispatch ↔ driver conversations. Each driver has one thread; messages arrive in real time in the driver app." />
      {drivers.length === 0 ? (
        <Card><EmptyState icon={MessageSquare} title="No drivers yet">Approve a driver under People to start a conversation.</EmptyState></Card>
      ) : (
        <Card className="grid overflow-hidden md:grid-cols-[280px_1fr]">
          <nav aria-label="Driver threads" className="border-b border-border md:border-b-0 md:border-r">
            <ul className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:overflow-visible">
              {drivers.map((d) => {
                const v = vehicles.find((x) => x.driverId === d.id);
                const on = d.id === active?.id;
                return (
                  <li key={d.id} className="shrink-0">
                    <button
                      onClick={() => setThreadId(d.id)}
                      aria-current={on ? "true" : undefined}
                      className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left", on ? "bg-primary-soft" : "hover:bg-surface-2")}
                    >
                      <Avatar name={d.name} />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">{d.name}</span>
                        <span className="block truncate text-[12px] text-fg-muted">{v ? `${v.id} · ${v.plate}` : "No vehicle"}{d.demo ? " · demo profile" : ""}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          {active && <ChatThread key={active.id} threadId={active.id} className="h-[calc(100dvh-260px)] min-h-[420px]" />}
        </Card>
      )}
    </>
  );
}
