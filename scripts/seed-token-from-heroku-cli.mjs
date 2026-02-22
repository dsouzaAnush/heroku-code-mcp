#!/usr/bin/env node
import { execSync } from "node:child_process";
import { randomBytes, createCipheriv } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const outPath = process.env.TOKEN_STORE_PATH || "./data/tokens.integration.json";
const userId = process.env.USER_ID || "default";
const keyBase64 = process.env.TOKEN_ENCRYPTION_KEY_BASE64 || randomBytes(32).toString("base64");

let token;
try {
  token = execSync("heroku auth:token", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
} catch (error) {
  console.error("Failed to read Heroku CLI token. Make sure `heroku auth:whoami` works.");
  process.exit(1);
}

if (!token) {
  console.error("Heroku token is empty.");
  process.exit(1);
}

const key = Buffer.from(keyBase64, "base64");
if (key.length !== 32) {
  console.error("TOKEN_ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
  process.exit(1);
}

const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const payload = JSON.stringify({
  accessToken: token,
  tokenType: "Bearer",
  scope: ["global"],
  obtainedAt: new Date().toISOString()
});
const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();

const store = {
  [userId]: {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  }
};

mkdirSync("./data", { recursive: true });
writeFileSync(outPath, JSON.stringify(store, null, 2), "utf8");

console.log(JSON.stringify({
  seeded: true,
  user_id: userId,
  token_store_path: outPath,
  token_encryption_key_base64: keyBase64
}, null, 2));
