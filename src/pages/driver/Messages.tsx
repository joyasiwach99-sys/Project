import { MessageSquare } from "lucide-react";
import { useDriver } from "@/components/layout/DriverLayout";
import { useAuth } from "@/context/AuthContext";
import { ChatThread } from "@/components/messages/ChatThread";
import { Card, EmptyState } from "@/components/ui/primitives";
import { DriverHeading, usePageTitle } from "@/components/driver/common";

export default function Messages() {
  usePageTitle("Messages");
  const { vehicle, isPreview, driverName } = useDriver();
  const { profile } = useAuth();
  const threadId = isPreview ? vehicle?.driverId ?? null : profile?.id ?? null;

  return (
    <div>
      <DriverHeading title="Dispatch" subtitle={isPreview ? `Conversation with ${driverName}` : "Messages with the operations team"} />
      <Card className="overflow-hidden">
        {threadId ? (
          <ChatThread threadId={threadId} quickReplies className="h-[calc(100dvh-250px)] min-h-[360px]" />
        ) : (
          <EmptyState icon={MessageSquare} title="No driver on this vehicle">
            Assign a driver to {vehicle?.id ?? "this vehicle"} to start a conversation.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
