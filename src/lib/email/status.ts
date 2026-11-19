// What /api/email/status returns to the Email tab.
export type EmailStatus =
  | { state: "not-set-up" }
  | { state: "not-connected" }
  | { state: "reconnect"; address: string }
  | { state: "connected"; name: string; address: string; connectedAt: string; last24h: { count: number; capped: boolean } | null; problem?: string; dev?: boolean };
