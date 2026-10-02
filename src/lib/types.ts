export interface UserSummary {
    id: string;
    name: string;
    email?: string;
}

export interface TicketSummary {
    id: string;
    title: string;
    description: string;
    status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    createdAt: string;
    updatedAt: string;
    tenant: UserSummary;
    assignedTo: UserSummary | null;
    images: { id: string; imageUrl: string }[];
}

export interface TicketDetail extends TicketSummary {
    activityLogs: {
        id: string;
        action: string;
        createdAt: string;
        user: { name: string; role: string };
    }[];
}

export interface NotificationSummary {
    id: string;
    message: string;
    read: boolean;
    createdAt: string;
}
