import { describe, expect, it } from "vitest";
import { TEST_WORKSPACE_ID, testWorkspaceOnly, type MondayClient } from "./client";

// A stand-in Monday: board 1 and item 10 are in the test workspace, board 2
// and item 20 are live. Records which mutations got through.
function fakeMonday() {
  const sent: string[] = [];
  const workspaceOf: Record<string, string> = { "board:1": TEST_WORKSPACE_ID, "board:2": "999", "item:10": TEST_WORKSPACE_ID, "item:20": "999" };
  const client: MondayClient = {
    async query<T>(query: string, variables: Record<string, unknown> = {}) {
      const id = String((variables.id as string[] | undefined)?.[0]);
      if (query.includes("boards(ids: $id)")) return { boards: [{ workspace: { id: workspaceOf[`board:${id}`] } }] } as T;
      if (query.includes("items(ids: $id)")) return { items: [{ board: { workspace: { id: workspaceOf[`item:${id}`] } } }] } as T;
      sent.push(query.trim().split(/\s+/)[0]);
      return {} as T;
    },
  };
  return { monday: testWorkspaceOnly(client), sent };
}

describe("development token: test workspace only", () => {
  it("lets reads and test-workspace writes through", async () => {
    const { monday, sent } = fakeMonday();
    await monday.query("{ me { id } }");
    await monday.query("mutation ($board: ID!, $item: ID!) { x }", { board: "1", item: "10" });
    await monday.query("mutation ($item: ID!) { x }", { item: "10" });
    expect(sent).toEqual(["{", "mutation", "mutation"]);
  });

  it.each([
    ["a live board", { board: "2", item: "10" }],
    ["a live item", { item: "20" }],
    ["a test board with a live item", { board: "1", item: "20" }],
    ["no board or item", { id: "123" }],
  ])("refuses a write to %s", async (_, variables) => {
    const { monday, sent } = fakeMonday();
    await expect(monday.query("mutation { x }", variables)).rejects.toThrow("only in the Broker App Test workspace");
    expect(sent).toEqual([]);
  });
});
