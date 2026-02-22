import { describe, expect, test } from "vitest";
import { normalizeHerokuSchema } from "../src/schema/catalog.js";

describe("normalizeHerokuSchema", () => {
  test("normalizes encoded path params and required body fields", () => {
    const schema = {
      definitions: {
        app: {
          links: [
            {
              href: "/apps/{(%23%2Fdefinitions%2Fapp%2Fdefinitions%2Fidentity)}",
              method: "GET",
              title: "Info",
              description: "Info for app",
              rel: "self"
            },
            {
              href: "/apps",
              method: "POST",
              title: "Create",
              description: "Create app",
              rel: "create",
              schema: {
                type: ["object"],
                required: ["name"],
                properties: {
                  name: {
                    type: ["string"]
                  }
                }
              }
            }
          ]
        }
      }
    };

    const normalized = normalizeHerokuSchema(schema);

    expect(normalized.operations).toHaveLength(2);
    expect(
      normalized.operations.map((operation) => ({
        operationId: operation.operationId,
        requiredParams: operation.requiredParams,
        isMutating: operation.isMutating
      }))
    ).toMatchInlineSnapshot(`
      [
        {
          "isMutating": false,
          "operationId": "GET /apps/{app_identity}",
          "requiredParams": [
            "app_identity",
          ],
        },
        {
          "isMutating": true,
          "operationId": "POST /apps",
          "requiredParams": [
            "body.name",
          ],
        },
      ]
    `);
  });
});
