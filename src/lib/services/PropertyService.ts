import { prisma } from '../prisma';
import { AppError } from '../errors/api-response';
import { lockUploader } from '../attachments';
import { z } from 'zod';

export const resourceId = z.string().uuid();
export const propertyInput = z.object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(500),
    description: z.string().trim().max(2000).nullable().optional(),
}).strict();
export const unitInput = z.object({
    identifier: z.string().trim().min(1).max(50).transform(value => value.toUpperCase()),
    floor: z.string().trim().max(50).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
}).strict();
export const assignmentInput = z.object({
    email: z.string().email(), unitId: resourceId.nullable(),
    expectedVersion: z.number().int().min(0),
}).strict();

export const locationSelect = { id: true, identifier: true, property: { select: { id: true, name: true, address: true } } } as const;
export const occupantSelect = { id: true, name: true, email: true, occupancyVersion: true, unit: { select: locationSelect } } as const;

export const PropertyService = {
    list: (managerId: string) => prisma.property.findMany({ where: { managerId }, include: { _count: { select: { units: true } } }, orderBy: { createdAt: 'desc' } }),
    create: (managerId: string, data: z.infer<typeof propertyInput>) => prisma.property.create({ data: { ...data, managerId } }),
    detail: async (managerId: string, id: string) => {
        const property = await prisma.property.findFirst({ where: { id, managerId }, include: {
            units: { include: { tenants: { select: occupantSelect } }, orderBy: { identifier: 'asc' } },
        } });
        if (!property) throw new AppError('Property not found', 404);
        return property;
    },
    edit: async (managerId: string, id: string, data: z.infer<typeof propertyInput>) => {
        const result = await prisma.property.updateMany({ where: { id, managerId }, data });
        if (!result.count) throw new AppError('Property not found', 404);
        return { id };
    },
    saveUnit: async (managerId: string, propertyId: string, data: z.infer<typeof unitInput>, id?: string) => prisma.$transaction(async db => {
        if (!await db.property.findFirst({ where: { id: propertyId, managerId }, select: { id: true } })) throw new AppError('Property not found', 404);
        if (id) {
            const result = await db.unit.updateMany({ where: { id, propertyId }, data });
            if (!result.count) throw new AppError('Unit not found', 404);
            return { id };
        }
        return db.unit.create({ data: { ...data, propertyId } });
    }),
    // Exact-email lookup avoids publishing a global tenant directory.
    lookupTenant: async (managerId: string, email: string) => {
        const tenant = await prisma.user.findFirst({ where: { email, role: 'TENANT', OR: [{ unitId: null }, { unit: { property: { managerId } } }] }, select: occupantSelect });
        if (!tenant) throw new AppError('Eligible tenant not found', 404);
        return tenant;
    },
    assignTenant: async (managerId: string, data: z.infer<typeof assignmentInput>) => prisma.$transaction(async db => {
        const tenant = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
        if (!tenant) throw new AppError('Eligible tenant not found', 404);
        await lockUploader(db, tenant.id);
        const current = await db.user.findFirst({ where: { id: tenant.id, role: 'TENANT', OR: [{ unitId: null }, { unit: { property: { managerId } } }] }, select: occupantSelect });
        if (!current) throw new AppError('Eligible tenant not found', 404);
        if (current.occupancyVersion !== data.expectedVersion) throw new AppError('Tenant assignment changed. Look up the tenant again.', 409);
        if (data.unitId && !await db.unit.findFirst({ where: { id: data.unitId, property: { managerId } }, select: { id: true } })) throw new AppError('Unit not found', 404);
        return db.user.update({ where: { id: tenant.id }, data: { unitId: data.unitId, occupancyVersion: { increment: 1 } }, select: occupantSelect });
    }),
};
