import { APP_VERSION, VERSION_HEADER } from "@/lib/version";

// fetch for the Email tab's own API calls. Sends the page's version itself:
// when the page opens on the Email tab, its first requests go out before
// AppUpdate has wrapped window.fetch, and the server would refuse them.
export function emailFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(VERSION_HEADER, APP_VERSION);
  return fetch(url, { cache: "no-store", ...init, headers });
}
