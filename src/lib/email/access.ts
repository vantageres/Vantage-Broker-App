// Who sees the Email tab while the monitor is being built: Monday user ids in
// EMAIL_MONITOR_USERS, comma-separated (John first). Nobody when it is unset.
export function emailMonitorAllowed(userId: string | undefined, list = process.env.EMAIL_MONITOR_USERS): boolean {
  if (!userId || !list) return false;
  return list.split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}
