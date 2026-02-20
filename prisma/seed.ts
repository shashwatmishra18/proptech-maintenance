import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
    const hashedPassword = await bcrypt.hash('password123', 10)

    console.log('Clearing database...')
    await prisma.activityLog.deleteMany()
    await prisma.notification.deleteMany()
    await prisma.ticketImage.deleteMany()
    await prisma.ticket.deleteMany()
    await prisma.user.deleteMany()

    console.log('Seeding demo users...')
    const tenant = await prisma.user.create({
        data: { name: 'Demo Tenant', email: 'tenant@test.com', password: hashedPassword, role: 'TENANT' }
    })
    const manager = await prisma.user.create({
        data: { name: 'Demo Manager', email: 'manager@test.com', password: hashedPassword, role: 'MANAGER' }
    })
    const tech = await prisma.user.create({
        data: { name: 'Demo Tech', email: 'tech@test.com', password: hashedPassword, role: 'TECHNICIAN' }
    })

    console.log('Seeding demo tickets...')

    // 1. OPEN Ticket
    await prisma.ticket.create({
        data: {
            title: 'Leaking Faucet in Unit 4B',
            description: 'The kitchen sink faucet is dripping constantly.',
            status: 'OPEN',
            priority: 'MEDIUM',
            tenantId: tenant.id,
            activityLogs: {
                create: { userId: tenant.id, action: 'Ticket created' }
            }
        }
    })

    // 2. ASSIGNED Ticket
    await prisma.ticket.create({
        data: {
            title: 'Broken AC',
            description: 'The AC unit is blowing hot air.',
            status: 'ASSIGNED',
            priority: 'HIGH',
            tenantId: tenant.id,
            assignedToId: tech.id,
            activityLogs: {
                create: [
                    { userId: tenant.id, action: 'Ticket created' },
                    { userId: manager.id, action: `Ticket assigned to ${tech.name}` }
                ]
            }
        }
    })

    // 3. DONE Ticket
    await prisma.ticket.create({
        data: {
            title: 'Lightbulb replacement hallway',
            description: 'The main hallway light is out.',
            status: 'DONE',
            priority: 'LOW',
            tenantId: tenant.id,
            assignedToId: tech.id,
            activityLogs: {
                create: [
                    { userId: tenant.id, action: 'Ticket created' },
                    { userId: manager.id, action: `Ticket assigned to ${tech.name}` },
                    { userId: tech.id, action: 'Status changed from ASSIGNED to IN_PROGRESS' },
                    { userId: tech.id, action: 'Status changed from IN_PROGRESS to DONE' }
                ]
            }
        }
    })

    console.log('Seeding complete!')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
