import { describe, expect, test } from "vitest";
import { SearchIndex } from "../src/search/search-index.js";
import type { HerokuOperation } from "../src/types.js";

function makeOperation(input: Partial<HerokuOperation>): HerokuOperation {
  return {
    operationId: input.operationId ?? "GET /apps",
    method: input.method ?? "GET",
    pathTemplate: input.pathTemplate ?? "/apps",
    rawHref: input.rawHref ?? "/apps",
    definitionName: input.definitionName ?? "app",
    pathParams: input.pathParams ?? [],
    requiredParams: input.requiredParams ?? [],
    isMutating: input.isMutating ?? false,
    searchText: input.searchText ?? "",
    title: input.title,
    description: input.description,
    rel: input.rel,
    requestSchema: input.requestSchema,
    targetSchemaRef: input.targetSchemaRef
  };
}

describe("SearchIndex", () => {
  test("ranks app listing for list apps query", () => {
    const index = new SearchIndex();
    index.setOperations(
      [
        makeOperation({
          operationId: "GET /apps",
          method: "GET",
          pathTemplate: "/apps",
          title: "List",
          description: "List apps for account",
          searchText: "list apps account"
        }),
        makeOperation({
          operationId: "GET /apps/{app_identity}/releases",
          method: "GET",
          pathTemplate: "/apps/{app_identity}/releases",
          title: "List Releases",
          description: "List releases",
          searchText: "releases history",
          pathParams: [{ name: "app_identity" }],
          requiredParams: ["app_identity"]
        })
      ],
      "Heroku Platform API reference"
    );

    const result = index.search({ query: "list apps", limit: 5 });
    expect(result.results[0]?.operation_id).toBe("GET /apps");
  });

  test("returns ranked disambiguation for releases query", () => {
    const index = new SearchIndex();
    index.setOperations(
      [
        makeOperation({
          operationId: "GET /apps/{app_identity}/releases",
          pathTemplate: "/apps/{app_identity}/releases",
          title: "List releases",
          searchText: "app releases"
        }),
        makeOperation({
          operationId: "GET /enterprise-accounts/{ea_identity}/releases",
          pathTemplate: "/enterprise-accounts/{ea_identity}/releases",
          title: "List enterprise releases",
          searchText: "enterprise releases"
        })
      ],
      ""
    );

    const result = index.search({ query: "releases", limit: 5 });
    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.results[0]?.score).toBeGreaterThanOrEqual(
      result.results[1]?.score ?? 0
    );
  });
});
