import { describe, expect, test } from "bun:test";
import { brandDestination } from "../components/Layout";

describe("brandDestination", () => {
  test("keeps signed-out visitors on the marketing page", () => {
    expect(brandDestination({ user: null, projects: [], loading: false })).toBe(
      "/",
    );
  });

  test("keeps the public destination during auth hydration", () => {
    expect(brandDestination({ user: null, projects: [], loading: true })).toBe(
      "/",
    );
  });

  test("sends signed-in users with no projects to project creation", () => {
    expect(
      brandDestination({
        user: {
          id: 1,
          email: "user@botholomew.test",
          name: "No Project",
          createdAt: 0,
          updatedAt: 0,
        },
        projects: [],
        loading: false,
      }),
    ).toBe("/projects/new");
  });

  test("sends signed-in users with projects to the project home", () => {
    expect(
      brandDestination({
        user: {
          id: 1,
          email: "user@botholomew.test",
          name: "Project User",
          createdAt: 0,
          updatedAt: 0,
        },
        projects: [
          {
            id: 1,
            name: "Project One",
            slug: "project-one",
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        loading: false,
      }),
    ).toBe("/home");
  });
});
