export interface UserSummary {
    id: string;
    name: string;
    email?: string;
}

export interface TicketSummary {
    version: number;
    property?: { id: string; name: string; address: string } | null;
    unit?: { id: string; identifier: string } | null;
    id: string;
    title: string;
    description: string;
    status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    createdAt: string;
    updatedAt: string;
    tenant: UserSummary;
    assignedTo: UserSummary | null;
    images: { id: string; imageUrl: string }[];
}

export interface TicketPage { tickets: TicketSummary[]; total: number; page: number; pageSize: number; totalPages: number }

export interface TicketDetail extends TicketSummary {
    activityLogs: {
        id: string;
        action: string;
        createdAt: string;
        user: { name: string; role: string };
    }[];
}

export interface NotificationSummary {
    ticketHref?: string | null;
    id: string;
    message: string;
    read: boolean;
    createdAt: string;
}

export interface NotificationPage { notifications: NotificationSummary[]; unreadCount: number; total: number; page: number; pageSize: number; totalPages: number; snapshotAt: string }
