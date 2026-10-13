// Minimal Monday GraphQL client. In the app each request carries the signed-in
// broker's OAuth token. In this development environment the token is added by
// the network proxy, so `token` may be omitted.

const API_URL = "https://api.monday.com/v2";
const API_VERSION = "2025-04";

export class MondayError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
  }
}

export interface MondayClient {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export function mondayClient(token?: string): MondayClient {
  return {
    async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "API-Version": API_VERSION,
      };
      if (token) headers.Authorization = token;
      const res = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new MondayError(`Monday returned HTTP ${res.status}`);
      const body = (await res.json()) as { data?: T; errors?: unknown[] };
      if (body.errors?.length) throw new MondayError("Monday rejected the request", body.errors);
      return body.data as T;
    },
  };
}
