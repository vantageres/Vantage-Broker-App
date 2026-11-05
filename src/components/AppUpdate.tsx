"use client";

import { useEffect, useState } from "react";
import { APP_VERSION, VERSION_HEADER } from "@/lib/version";

// Keeps an open page in step with the server (see lib/version.ts). Every
// request to the app's own API carries this page's version; when the server
// says it has moved on, or when the page comes back into view and the server
// reports a newer version, a banner asks the broker to reload.
export function AppUpdate() {
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(VERSION_HEADER, APP_VERSION);
      const res = await original(input, { ...init, headers });
      const server = res.headers.get(VERSION_HEADER);
      if (server && server !== APP_VERSION) setUpdated(true);
      return res;
    };

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await original("/api/version", { cache: "no-store" });
        const { version } = (await res.json()) as { version?: string };
        if (version && version !== APP_VERSION) setUpdated(true);
      } catch {
        // Offline or the server is busy: check again next time.
      }
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      window.fetch = original;
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!updated) return null;
  return (
    <div className="update-banner" role="alert">
      <span>The app has been updated. Reload to use the new version.</span>
      <button className="small-btn solid" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
