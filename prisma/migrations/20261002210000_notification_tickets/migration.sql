-- Additive: existing notifications remain readable with a null ticket reference.
ALTER TABLE "Notification" ADD COLUMN "ticketId" TEXT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Notification_ticketId_idx" ON "Notification"("ticketId");
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");
