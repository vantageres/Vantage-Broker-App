"use client";

import { useCallback, useEffect, useState } from "react";

// Monday's sign-in page doesn't work in a phone browser (it asks for the
// Monday app instead), so on a phone the main choice is a code entered on a
// computer (see lib/link.ts). Computers sign in with Monday directly.

type Link =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; code: string; expiresAt: number }
  | { step: "expired" }
  | { step: "failed" };

function onPhone() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

const POLL_MS = 3000;

export function SignInChoices() {
  const [phone, setPhone] = useState(false);
  const [link, setLink] = useState<Link>({ step: "idle" });
  const [now, setNow] = useState(() => Date.now());

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/link/status", { cache: "no-store" });
      const body = await res.json();
      if (body.status === "signed-in") window.location.replace("/");
      else if (body.status === "waiting") setLink({ step: "waiting", code: body.code, expiresAt: body.expiresAt });
      else if (body.status === "expired") setLink({ step: "expired" });
    } catch {
      // Offline for a moment: the next check tries again.
    }
  }, []);

  useEffect(() => {
    setPhone(onPhone());
    check(); // picks up a code that was showing before the app was closed
  }, [check]);

  const waiting = link.step === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(check, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const back = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", back);
    };
  }, [waiting, check]);

  async function start() {
    setLink({ step: "starting" });
    try {
      const res = await fetch("/api/link/start", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error();
      setLink({ step: "waiting", code: body.code, expiresAt: body.expiresAt });
    } catch {
      setLink({ step: "failed" });
    }
  }

  const monday = <a className="approve" href="/api/auth/login">Sign in with Monday</a>;
  if (!phone && link.step === "idle") {
    return (
      <>
        {monday}
        <button type="button" className="text-link" onClick={start}>Signing in on a phone? Use a code</button>
      </>
    );
  }

  if (link.step === "waiting") {
    const left = Math.max(0, link.expiresAt - now);
    const mins = Math.floor(left / 60000);
    const secs = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
    return (
      <>
        <p>On your computer, open <strong>{window.location.host}/link</strong>, sign in with Monday, and enter this code:</p>
        <p className="link-shown" aria-live="polite">{link.code}</p>
        <p className="inline-msg">{left > 0 ? `Works for ${mins}:${secs}. This page signs in by itself.` : "Checking…"}</p>
        <button type="button" className="text-link" onClick={start}>Get a new code</button>
      </>
    );
  }

  return (
    <>
      {link.step === "expired" && <p className="inline-msg bad" role="alert">That code has expired. Get a new one.</p>}
      {link.step === "failed" && <p className="inline-msg bad" role="alert">Couldn&apos;t get a code. Check your connection and try again.</p>}
      <p>Monday doesn&apos;t sign in from a phone browser, so sign in this phone from your computer.</p>
      <button type="button" className="approve" onClick={start} disabled={link.step === "starting"}>
        {link.step === "starting" ? "Getting a code…" : "Sign in with your computer"}
      </button>
      <a className="text-link" href="/api/auth/login">Try Monday sign-in on this phone</a>
    </>
  );
}
