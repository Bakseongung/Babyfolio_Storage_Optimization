import { afterEach, describe, expect, it } from "vitest";
import { env } from "../src/common/env.js";

const originalPort = process.env.PORT;
const originalSessionTtl = process.env.SESSION_TTL_DAYS;
const originalSignedUrlTtl = process.env.SIGNED_URL_TTL_SECONDS;
const originalMaxActiveUploads = process.env.MAX_ACTIVE_UPLOADS_PER_USER;

afterEach(() => {
  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
  if (originalSessionTtl === undefined) delete process.env.SESSION_TTL_DAYS;
  else process.env.SESSION_TTL_DAYS = originalSessionTtl;
  if (originalSignedUrlTtl === undefined) delete process.env.SIGNED_URL_TTL_SECONDS;
  else process.env.SIGNED_URL_TTL_SECONDS = originalSignedUrlTtl;
  if (originalMaxActiveUploads === undefined) delete process.env.MAX_ACTIVE_UPLOADS_PER_USER;
  else process.env.MAX_ACTIVE_UPLOADS_PER_USER = originalMaxActiveUploads;
});

describe("numeric environment configuration", () => {
  it("rejects invalid positive numbers", () => {
    process.env.PORT = "not-a-port";
    process.env.SESSION_TTL_DAYS = "0";
    process.env.SIGNED_URL_TTL_SECONDS = "1.5";

    expect(() => env.port).toThrow("PORT must be a positive integer");
    expect(() => env.sessionTtlDays).toThrow("SESSION_TTL_DAYS must be a positive number");
    expect(() => env.signedUrlTtl).toThrow("SIGNED_URL_TTL_SECONDS must be a positive integer");
  });

  it("parses valid values", () => {
    process.env.PORT = "4100";
    process.env.SESSION_TTL_DAYS = "14";
    process.env.SIGNED_URL_TTL_SECONDS = "600";

    expect(env.port).toBe(4100);
    expect(env.sessionTtlDays).toBe(14);
    expect(env.signedUrlTtl).toBe(600);
  });

  it("defaults the per-user active upload limit to five and bounds overrides", () => {
    delete process.env.MAX_ACTIVE_UPLOADS_PER_USER;
    expect(env.maxActiveUploadsPerUser).toBe(5);

    process.env.MAX_ACTIVE_UPLOADS_PER_USER = "8";
    expect(env.maxActiveUploadsPerUser).toBe(8);

    process.env.MAX_ACTIVE_UPLOADS_PER_USER = "0";
    expect(() => env.maxActiveUploadsPerUser).toThrow("MAX_ACTIVE_UPLOADS_PER_USER must be a positive integer");

    process.env.MAX_ACTIVE_UPLOADS_PER_USER = "21";
    expect(() => env.maxActiveUploadsPerUser).toThrow("MAX_ACTIVE_UPLOADS_PER_USER must be at most 20");
  });
});
