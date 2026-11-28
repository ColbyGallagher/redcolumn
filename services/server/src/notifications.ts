import { randomUUID } from 'node:crypto';

export type NotificationKind = 'release' | 'return';

export interface NotificationMessage {
  id: string;
  kind: NotificationKind;
  projectId: string;
  scopeId: string;
  recipientUserId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface NotificationSink {
  send(message: NotificationMessage): void | Promise<void>;
}

/** In-process sink that captures outbound notifications/emails for tests and local runs. */
export class InMemoryNotificationSink implements NotificationSink {
  private readonly items: NotificationMessage[] = [];

  send(message: NotificationMessage): void {
    this.items.push(message);
  }

  all(): readonly NotificationMessage[] {
    return this.items;
  }

  forUser(userId: string): NotificationMessage[] {
    return this.items.filter((m) => m.recipientUserId === userId);
  }

  forEmail(email: string): NotificationMessage[] {
    const lower = email.toLowerCase();
    return this.items.filter((m) => m.recipientEmail.toLowerCase() === lower);
  }

  clear(): void {
    this.items.length = 0;
  }
}

export function createNotification(
  input: Omit<NotificationMessage, 'id' | 'createdAt'>,
  now: () => number = () => Date.now(),
): NotificationMessage {
  return {
    id: randomUUID(),
    ...input,
    createdAt: new Date(now()).toISOString(),
  };
}
