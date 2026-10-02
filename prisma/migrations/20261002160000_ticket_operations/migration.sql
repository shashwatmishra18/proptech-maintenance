-- Additive: all existing statuses and ticket data remain unchanged.
ALTER TYPE "Status" ADD VALUE 'CANCELLED';
ALTER TABLE "Ticket" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
