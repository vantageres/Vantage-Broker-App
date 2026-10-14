"use client";

import { useEffect } from "react";

// Shown when a screen crashes. The reason is shown and sent to the server log
// so the problem can be found; notes and Monday data are not included.
export default function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest,
        stack: error.stack?.split("\n").slice(0, 6).join("\n"),
        path: window.location.pathname,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <main className="signin">
      <p><strong>Something went wrong on this screen.</strong> Nothing was saved.</p>
      <p className="inline-msg" style={{ maxWidth: 360, overflowWrap: "anywhere" }}>
        Details: {error.message || "no message"}{error.digest ? ` (ref ${error.digest})` : ""}
      </p>
      {error.stack && (
        <pre className="inline-msg" style={{ maxWidth: 360, whiteSpace: "pre-wrap", overflowWrap: "anywhere", textAlign: "left", fontSize: 11 }}>
          {error.stack.split("\n").slice(0, 5).join("\n")}
        </pre>
      )}
      <button className="approve" onClick={() => retry()}>Try again</button>
      <a className="secondary" href="/" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Start over</a>
    </main>
  );
}
