import fs from "node:fs";
import https from "node:https";
import process from "node:process";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const root = new URL("../", import.meta.url);
const serverJsonUrl = new URL("server.json", root);
const schemaUrl = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`GET ${url} failed with HTTP ${response.statusCode}`));
          response.resume();
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

const schema = await getJson(schemaUrl);
const serverJson = JSON.parse(fs.readFileSync(serverJsonUrl, "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(serverJson)) {
  console.error(ajv.errorsText(validate.errors, { separator: "\n" }));
  process.exit(1);
}

console.log("server.json is valid");
