import Link from "next/link";
import { Back, History } from "./icons";

export function TopBar() {
  return (
    <header className="topbar">
      <span aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/vantage-logo.png" alt="Vantage Commercial" />
      <Link className="saved-link" href="/saved" aria-label="Saved today">
        <History />
        <span className="saved-label">Saved today</span>
      </Link>
    </header>
  );
}

export function BackBar({ title }: { title: string }) {
  return (
    <header className="topbar" style={{ gridTemplateColumns: "44px minmax(0, 1fr) 44px" }}>
      <Link className="back-link" href="/" aria-label="Back">
        <Back />
      </Link>
      <h1>{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}
