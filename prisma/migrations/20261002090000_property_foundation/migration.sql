-- AlterTable
ALTER TABLE "User" ADD COLUMN     "occupancyVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unitId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "propertyId" TEXT,
ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "description" TEXT,
    "managerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "floor" TEXT,
    "description" TEXT,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_managerId_idx" ON "Property"("managerId");
CREATE INDEX "User_unitId_idx" ON "User"("unitId");

-- New nullable relations leave every legacy row unchanged.
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_unit_requires_property" CHECK ("unitId" IS NULL OR "propertyId" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_occupancy_tenant_only" CHECK ("unitId" IS NULL OR "role" = 'TENANT');

-- CreateIndex
CREATE UNIQUE INDEX "Unit_propertyId_identifier_key" ON "Unit"("propertyId", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_id_propertyId_key" ON "Unit"("id", "propertyId");

-- CreateIndex
CREATE INDEX "Ticket_propertyId_idx" ON "Ticket"("propertyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_unitId_propertyId_fkey" FOREIGN KEY ("unitId", "propertyId") REFERENCES "Unit"("id", "propertyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

