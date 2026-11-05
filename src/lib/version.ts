// The app's version: the commit the deployment was built from, put into both
// the browser code and the server code at build time (next.config.ts). A page
// left open across a deploy keeps running the old browser code against the new
// server, which once saved a Lead's fields without qualifying it. So every API
// request carries the browser's version, and the server refuses one that
// doesn't match its own, before anything is saved.

export const APP_VERSION = process.env.APP_VERSION || "dev";
export const VERSION_HEADER = "x-app-version";
export const UPDATED_MESSAGE = "The app was just updated, so nothing was saved. Reload to get the new version, then try again.";
