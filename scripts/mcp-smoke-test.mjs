#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const serverUrl = process.env.MCP_URL || "http://127.0.0.1:3000/mcp";
const userId = process.env.USER_ID || "default";
const operationId = process.env.READ_OPERATION_ID || "GET /apps";

const client = new Client({
  name: "heroku-mcp-smoke-test",
  version: "0.1.0"
});

const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
  requestInit: {
    headers: {
      "x-user-id": userId
    }
  }
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const auth = await client.callTool({ name: "auth_status", arguments: {} });
  const search = await client.callTool({
    name: "search",
    arguments: { query: "list apps", limit: 3 }
  });
  const execute = await client.callTool({
    name: "execute",
    arguments: { operation_id: operationId }
  });

  console.log(JSON.stringify({
    server_url: serverUrl,
    user_id: userId,
    tools: tools.tools.map((tool) => tool.name).sort(),
    auth_status: auth.content?.[0]?.type === "text" ? auth.content[0].text : null,
    search_result: search.content?.[0]?.type === "text" ? search.content[0].text : null,
    execute_is_error: Boolean(execute.isError),
    execute_result_excerpt:
      execute.content?.[0]?.type === "text"
        ? execute.content[0].text.slice(0, 1200)
        : null
  }, null, 2));
} finally {
  await client.close().catch(() => {});
  await transport.terminateSession().catch(() => {});
}
