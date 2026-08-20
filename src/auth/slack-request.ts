import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_REQUEST_AGE_SECONDS = 5 * 60;

type HeaderValue = string | string[] | undefined;

function firstHeader(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifySlackRequest(options: {
  headers: Record<string, HeaderValue>;
  rawBody: string;
  signingSecret: string | string[];
  nowMs?: number;
}): boolean {
  const timestamp = firstHeader(options.headers["x-slack-request-timestamp"]);
  const signature = firstHeader(options.headers["x-slack-signature"]);

  if (!timestamp || !signature || !/^v0=[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_REQUEST_AGE_SECONDS) {
    return false;
  }

  const baseString = `v0:${timestamp}:${options.rawBody}`;
  const signingSecrets = Array.isArray(options.signingSecret)
    ? options.signingSecret
    : [options.signingSecret];

  return signingSecrets.some((signingSecret) => {
    const expected = `v0=${createHmac("sha256", signingSecret)
      .update(baseString)
      .digest("hex")}`;

    return safeEqual(expected, signature);
  });
}
