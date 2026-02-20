# Property Maintenance Management System

A robust, mobile-first web MVP for property maintenance request tracking and assignment. Features strict workflow validation, role-based access control, file uploads, and a dashboard metrics system.

## Setup Instructions

Ensure you have Node.js 18+ and Docker installed.

1. **Install Dependencies**
   ```bash
   cd c:/proptech
   npm install
   ```

2. **Database Setup**
   Ensure Docker is running, then start the PostgreSQL container:
   ```bash
   docker compose up -d db
   ```

3. **Environment Variables**
   Rename `.env.example` to `.env` (or just use the provided `.env` if already generated).
   ```text
   DATABASE_URL="postgresql://proptech:password123@localhost:5432/proptech_db?schema=public"
   JWT_SECRET="super-secret-key-change-me-in-production"
   ```

4. **Initialize DB & Seed**
   ```bash
   npx prisma db push
   npx prisma generate
   npm run prisma:seed
   ```

5. **Run the Application**
   ```bash
   npm run dev
   ```

The app will be available at [http://localhost:3000](http://localhost:3000).

---

## Test Credentials

Three demo accounts are seeded automatically:

| Role       | Email            | Password    |
| ---------- | ---------------- | ----------- |
| Tenant     | tenant@test.com  | password123 |
| Manager    | manager@test.com | password123 |
| Technician | tech@test.com    | password123 |

---

## Docker Deployment

To build and run the entire application using Docker:

1. Build the production image:
   ```bash
   docker build -t proptech-app .
   ```
2. For production, add the Next.js service to `docker-compose.yml` to run alongside Postgres, and volume mount `./public/uploads` for persistence.

---

## API Documentation

- `POST /api/auth/login` - Authenticate
- `POST /api/auth/register` - Register a demo user
- `POST /api/auth/logout` - Clear session

- `POST /api/tickets` - [Tenant] Create new ticket
- `GET /api/tickets` - List tickets (filtered by role constraints)
- `GET /api/tickets/:id` - Get details of specific ticket
- `POST /api/tickets/:id/status` - [Manager] Assign technician (`{ technicianId: "" }`)
- `PATCH /api/tickets/:id/status` - [Tech] Update status (`{ status: "IN_PROGRESS" | "DONE" }`)
- `POST /api/tickets/:id/notes` - Add a note to activity log
- `POST /api/upload` - Upload up to 5 images (JPG/PNG max 5MB)
- `GET /api/metrics` - Fetch aggregated role-based metrics counts
- `GET /api/notifications` - Fetch unread counts and recent alerts
- `PATCH /api/notifications` - Mark notifications read

---

## Workflow Logic & Architecture

### Allowed Transitions
- `OPEN -> ASSIGNED` (Manager assigns, logs entry)
- `ASSIGNED -> IN_PROGRESS` (Technician marks started)
- `IN_PROGRESS -> DONE` (Technician marks complete)

These rules are strictly enforced in `lib/services/TicketService.ts`. Reverting to previous states or skipping states returns a `400 Bad Request`.

## ER Diagram

```mermaid
erDiagram
    User {
        String id PK
        String name
        String email UK
        String password
        Role role
        DateTime createdAt
    }
    Ticket {
        String id PK
        String title
        String description
        Status status
        Priority priority
        String tenantId FK
        String assignedToId FK
        DateTime createdAt
        DateTime updatedAt
    }
    TicketImage {
        String id PK
        String ticketId FK
        String imageUrl
    }
    ActivityLog {
        String id PK
        String ticketId FK
        String userId FK
        String action
        DateTime createdAt
    }
    Notification {
        String id PK
        String userId FK
        String message
        Boolean read
        DateTime createdAt
    }

    User ||--o{ Ticket : "TenantTickets"
    User ||--o{ Ticket : "AssignedTickets"
    Ticket ||--o{ TicketImage : "has"
    Ticket ||--o{ ActivityLog : "has logs"
    User ||--o{ ActivityLog : "creates"
    User ||--o{ Notification : "receives"
```
