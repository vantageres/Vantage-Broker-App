"use client";

import { useState } from "react";
import type { ApprovalSettings, Mode } from "@/lib/approvals";

type Action = { id: string; name: string; detail: string };

const OPTIONS: { mode: Mode; label: string }[] = [
  { mode: "confirm", label: "Always confirm" },
  { mode: "auto", label: "Save without asking" },
];

function changedLine(s: ApprovalSettings) {
  if (!s.changedBy || !s.changedAt) return "No changes yet.";
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(s.changedAt));
  return `Last changed by ${s.changedBy}, ${when}.`;
}

export function ApprovalToggles({ actions, initial }: { actions: Action[]; initial: ApprovalSettings }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(action: string, mode: Mode) {
    if (saving || settings.modes[action as keyof ApprovalSettings["modes"]] === mode) return;
    setSaving(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) window.location.href = "/signin";
      else if (!res.ok) setError(body.error ?? "The setting couldn't be saved.");
      else setSettings(body as ApprovalSettings);
    } catch {
      setError("The setting couldn't be saved. Check the connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      <section className="admin-list">
        {actions.map((a) => {
          const current = settings.modes[a.id as keyof ApprovalSettings["modes"]];
          return (
            <div className="admin-row" key={a.id}>
              <div className="admin-text">
                <div className="name">{a.name}</div>
                <div className="detail">{a.detail}</div>
              </div>
              <div className="segmented" role="group" aria-label={a.name} aria-busy={saving === a.id}>
                {OPTIONS.map((o) => (
                  <button
                    key={o.mode}
                    type="button"
                    aria-pressed={current === o.mode}
                    disabled={saving !== null}
                    onClick={() => choose(a.id, o.mode)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>
      <p className="admin-foot">{changedLine(settings)} Brokers can still cancel any change before it saves.</p>
    </>
  );
}
