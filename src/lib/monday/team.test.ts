import { describe, expect, it } from "vitest";
import { TEST_BOARDS } from "./boards";
import type { MondayClient } from "./client";
import { findBroker, readTeam } from "./team";

const monday = (teams: { name: string; users: { id: number; name: string; enabled?: boolean; is_guest?: boolean }[] }[]): MondayClient => ({
  async query<T>(query: string) {
    if (query.includes("subscribers")) return { boards: [{ owners: [{ id: 24542650 }], subscribers: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }] } as T;
    return { teams: teams.map((t) => ({ ...t, users: t.users.map((u) => ({ enabled: true, is_guest: false, ...u })) })) } as T;
  },
});

describe("readTeam", () => {
  it("offers the Brokers team members who are on the board, by name", async () => {
    const team = await readTeam(monday([
      { name: "Vantage PM", users: [{ id: 4, name: "Andrea Hannigan" }] },
      { name: "Brokers Team", users: [{ id: 2, name: "Ken Richardson" }, { id: 1, name: "Emily Stein" }, { id: 3, name: "Gone", enabled: false }, { id: 99, name: "Elsewhere" }] },
    ]), TEST_BOARDS.leads);
    expect(team).toEqual({ owners: ["24542650"], people: [{ id: "1", name: "Emily Stein" }, { id: "2", name: "Ken Richardson" }] });
  });

  it("finds the team as Brokers or Brokers Team", async () => {
    expect((await readTeam(monday([{ name: "brokers", users: [{ id: 1, name: "Emily Stein" }] }]), TEST_BOARDS.leads)).people).toHaveLength(1);
  });

  it("explains a missing team rather than offering everyone", async () => {
    expect(await readTeam(monday([{ name: "Vantage PM", users: [{ id: 1, name: "Emily Stein" }] }]), TEST_BOARDS.leads))
      .toEqual({ owners: ["24542650"], people: [], problem: "There's no team named Brokers in Monday." });
  });
});

describe("findBroker", () => {
  const people = [
    { id: "1", name: "Emily Stein" }, { id: "2", name: "Ken Richardson" },
    { id: "3", name: "John Smyth" }, { id: "4", name: "John Doss" },
  ];
  it("finds a broker by full, first or last name", () => {
    expect(findBroker("Emily", people)).toEqual({ person: people[0] });
    expect(findBroker("ken richardson", people)).toEqual({ person: people[1] });
    expect(findBroker("Doss", people)).toEqual({ person: people[3] });
  });
  it("never guesses between two brokers with the same name", () => {
    expect(findBroker("John", people)).toEqual({ problem: 'John Smyth and John Doss are both in the Brokers team, so choose which one for "John".' });
  });
  it("says when no broker has the name", () => {
    expect(findBroker("Andrea", people)).toEqual({ problem: 'No one named "Andrea" is in the Brokers team, so choose who you meant.' });
  });
});
