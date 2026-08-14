export interface Command {
    id: string;
    title: string;
    subtitle?: string;
    icon?: string;
    shortcut?: string;
    category?: string;
    categoryOrder?: number;
    keywords?: string[];
    priority?: number;
    showWhenIdle?: boolean;
    badge?: string;
    badgeTone?: 'neutral' | 'success' | 'warning' | 'accent';
    dangerous?: boolean;
    sessionId?: string;
    action: () => void | Promise<void>;
}

export interface CommandCategory {
    id: string;
    title: string;
    order: number;
    commands: Command[];
}
