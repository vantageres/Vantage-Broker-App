"use client";

import { useState } from "react";
import { Conversation } from "../Conversation";
import { EmailTab } from "./EmailTab";

type Tab = "assistant" | "email";

// The home screen's two tabs. The conversation stays mounted while Email is
// showing, so switching back keeps the chat and any open proposal.
export function HomeTabs({ firstName, startOn, outcome }: { firstName: string; startOn: Tab; outcome?: string }) {
  const [tab, setTab] = useState<Tab>(startOn);
  const [emailOpened, setEmailOpened] = useState(startOn === "email");

  function choose(next: Tab) {
    setTab(next);
    if (next === "email") setEmailOpened(true);
    // Keep the tab in the address, without the one-time Outlook result.
    window.history.replaceState(null, "", next === "email" ? "/?tab=email" : "/");
  }

  return (
    <>
      <div hidden={tab !== "assistant"} style={{ display: tab === "assistant" ? "contents" : "none" }}>
        <Conversation firstName={firstName} />
      </div>
      {emailOpened && (
        <div hidden={tab !== "email"} style={{ display: tab === "email" ? "contents" : "none" }}>
          <EmailTab outcome={tab === "email" ? outcome : undefined} />
        </div>
      )}
      {/* A footer, so the switch stays in reach while the broker scrolls. */}
      <nav className="home-tabs" role="tablist" aria-label="Home">
        <button type="button" role="tab" aria-selected={tab === "assistant"} className="home-tab" onClick={() => choose("assistant")}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
          Assistant
        </button>
        <button type="button" role="tab" aria-selected={tab === "email"} className="home-tab" onClick={() => choose("email")}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
          Email
        </button>
      </nav>
    </>
  );
}
