-- Additive: existing accounts remain active, and version-zero sessions stay valid.
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "onboardedById" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_onboardedById_fkey" FOREIGN KEY ("onboardedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_onboardedById_idx" ON "User"("onboardedById");
CREATE TYPE "CredentialPurpose" AS ENUM ('INVITE', 'RESET');
CREATE TABLE "CredentialToken" (
"id" TEXT NOT NULL PRIMARY KEY, "tokenHash" TEXT NOT NULL,
"purpose" "CredentialPurpose" NOT NULL, "email" TEXT NOT NULL, "role" "Role" NOT NULL,
"authVersion" INTEGER NOT NULL, "userId" TEXT NOT NULL, "createdById" TEXT,
"expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "CredentialToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "CredentialToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "CredentialToken_tokenHash_key" ON "CredentialToken"("tokenHash");
CREATE INDEX "CredentialToken_userId_purpose_idx" ON "CredentialToken"("userId", "purpose");
CREATE INDEX "CredentialToken_createdById_idx" ON "CredentialToken"("createdById");
CREATE TABLE "AccountEvent" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "actorId" TEXT, "action" TEXT NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "AccountEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "AccountEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE INDEX "AccountEvent_userId_idx" ON "AccountEvent"("userId");
