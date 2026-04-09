import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, validateCredentials, DEFAULT_PROMPT } from "../config.js";

describe("loadConfig", () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env to avoid leaking between tests
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    process.env.AWS_SESSION_TOKEN = "test-token";
    process.env.AWS_REGION = "us-east-1";
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
  });

  it("uses DEFAULT_PROMPT when no arguments provided", () => {
    process.argv = ["node", "main.tsx"];
    const config = loadConfig();
    expect(config.prompt).toBe(DEFAULT_PROMPT);
  });

  it("uses provided prompt from argv[2]", () => {
    process.argv = ["node", "main.tsx", "素数を100個出力して"];
    const config = loadConfig();
    expect(config.prompt).toBe("素数を100個出力して");
  });

  it("parses --output-dir option", () => {
    process.argv = ["node", "main.tsx", "--output-dir=./report"];
    const config = loadConfig();
    expect(config.outputDir).toBe("./report");
  });

  it("parses prompt and --output-dir together", () => {
    process.argv = [
      "node",
      "main.tsx",
      "Hello World を出力して",
      "--output-dir=/tmp/out",
    ];
    const config = loadConfig();
    expect(config.prompt).toBe("Hello World を出力して");
    expect(config.outputDir).toBe("/tmp/out");
  });

  it("sets outputDir to null when not specified", () => {
    process.argv = ["node", "main.tsx"];
    const config = loadConfig();
    expect(config.outputDir).toBeNull();
  });

  it("always sets agentCount to 5", () => {
    process.argv = ["node", "main.tsx"];
    const config = loadConfig();
    expect(config.agentCount).toBe(5);
  });

  it("reads AWS credentials from environment variables", () => {
    process.argv = ["node", "main.tsx"];
    process.env.AWS_ACCESS_KEY_ID = "AKIA_TEST";
    process.env.AWS_SECRET_ACCESS_KEY = "secret123";
    process.env.AWS_SESSION_TOKEN = "token456";
    process.env.AWS_REGION = "ap-northeast-1";

    const config = loadConfig();
    expect(config.awsCredentials).toEqual({
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret123",
      sessionToken: "token456",
      region: "ap-northeast-1",
    });
  });

  it("defaults credentials to empty strings when env vars are missing", () => {
    process.argv = ["node", "main.tsx"];
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_REGION;

    const config = loadConfig();
    expect(config.awsCredentials.accessKeyId).toBe("");
    expect(config.awsCredentials.secretAccessKey).toBe("");
    expect(config.awsCredentials.sessionToken).toBe("");
    expect(config.awsCredentials.region).toBe("");
  });
});

describe("validateCredentials", () => {
  it("returns true when all fields are non-empty", async () => {
    const creds = {
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      sessionToken: "token",
      region: "us-east-1",
    };
    expect(await validateCredentials(creds)).toBe(true);
  });

  it("returns false when accessKeyId is empty", async () => {
    const creds = {
      accessKeyId: "",
      secretAccessKey: "secret",
      sessionToken: "token",
      region: "us-east-1",
    };
    expect(await validateCredentials(creds)).toBe(false);
  });

  it("returns false when secretAccessKey is empty", async () => {
    const creds = {
      accessKeyId: "key",
      secretAccessKey: "",
      sessionToken: "token",
      region: "us-east-1",
    };
    expect(await validateCredentials(creds)).toBe(false);
  });

  it("returns false when sessionToken is empty", async () => {
    const creds = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      sessionToken: "",
      region: "us-east-1",
    };
    expect(await validateCredentials(creds)).toBe(false);
  });

  it("returns false when region is empty", async () => {
    const creds = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      sessionToken: "token",
      region: "",
    };
    expect(await validateCredentials(creds)).toBe(false);
  });
});
