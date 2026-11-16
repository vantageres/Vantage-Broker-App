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
      <nav className="home-tabs" role="tablist" aria-label="Home">
        <button type="button" role="tab" aria-selected={tab === "assistant"} className="home-tab" onClick={() => choose("assistant")}>
          Assistant
        </button>
        <button type="button" role="tab" aria-selected={tab === "email"} className="home-tab" onClick={() => choose("email")}>
          Email
        </button>
      </nav>
      <div hidden={tab !== "assistant"} style={{ display: tab === "assistant" ? "contents" : "none" }}>
        <Conversation firstName={firstName} />
      </div>
      {emailOpened && (
        <div hidden={tab !== "email"} style={{ display: tab === "email" ? "contents" : "none" }}>
          <EmailTab outcome={tab === "email" ? outcome : undefined} />
        </div>
      )}
    </>
  );
}
