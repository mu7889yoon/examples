import { describe, it, expect } from "vitest";
import { parseSessionEvent, truncateThought } from "../event-parser.js";

// ── truncateThought ──────────────────────────────────────────────

describe("truncateThought", () => {
  it("returns short text as-is", () => {
    expect(truncateThought("hello")).toBe("hello");
  });

  it("returns text exactly at maxLen as-is", () => {
    const text = "a".repeat(80);
    expect(truncateThought(text)).toBe(text);
  });

  it("truncates text exceeding default maxLen and appends …", () => {
    const text = "a".repeat(100);
    const result = truncateThought(text);
    expect(result.length).toBe(80);
    expect(result.endsWith("…")).toBe(true);
  });

  it("respects custom maxLen", () => {
    const result = truncateThought("abcdefghij", 5);
    expect(result).toBe("abcd…");
    expect(result.length).toBe(5);
  });

  it("handles empty string", () => {
    expect(truncateThought("")).toBe("");
  });
});

// ── parseSessionEvent ────────────────────────────────────────────

describe("parseSessionEvent", () => {
  it("classifies thinking events", () => {
    const event = { method: "textGeneration", params: { text: "Let me think about FizzBuzz" } };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("thinking");
    expect(parsed.icon).toBe("💭");
    expect(parsed.summary).toContain("💭");
    expect(parsed.summary).toContain("Let me think about FizzBuzz");
  });

  it("classifies file_write events", () => {
    const event = { method: "file_write", params: { path: "/home/user/fizzbuzz.js" } };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("file_write");
    expect(parsed.icon).toBe("📝");
    expect(parsed.summary).toBe("📝 fizzbuzz.js");
  });

  it("classifies command_exec events", () => {
    const event = { method: "exec", params: { command: "node fizzbuzz.js" } };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("command_exec");
    expect(parsed.icon).toBe("▶");
    expect(parsed.summary).toBe("▶ node fizzbuzz.js");
  });

  it("classifies unknown methods as tool_call", () => {
    const event = { method: "custom_tool", params: { name: "my_tool" } };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("tool_call");
    expect(parsed.icon).toBe("🔧");
    expect(parsed.summary).toBe("🔧 my_tool");
  });

  it("uses method as tool name when params.name is missing", () => {
    const event = { method: "unknown_action", params: {} };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("tool_call");
    expect(parsed.summary).toBe("🔧 unknown_action");
  });

  it("includes timestamp and raw event", () => {
    const event = { method: "textGeneration", params: { text: "hi" } };
    const before = Date.now();
    const parsed = parseSessionEvent(event);
    expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
    expect(parsed.timestamp).toBeLessThanOrEqual(Date.now());
    expect(parsed.raw).toBe(event);
  });

  it("handles null params gracefully", () => {
    const event = { method: "thinking", params: null };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("thinking");
    expect(parsed.icon).toBe("💭");
  });

  it("truncates long thinking text in summary", () => {
    const longText = "a".repeat(200);
    const event = { method: "textGeneration", params: { text: longText } };
    const parsed = parseSessionEvent(event);
    // "💭 " prefix (2 chars) + truncated text (80 chars)
    expect(parsed.summary.length).toBeLessThanOrEqual(83);
  });

  it("extracts filename from path for file_write", () => {
    const event = { method: "writeFile", params: { path: "/workspace/src/main.py" } };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("file_write");
    expect(parsed.summary).toBe("📝 main.py");
  });

  it("uses params.content for thinking when params.text is absent", () => {
    const event = { method: "streamContent", params: { content: "Thinking about it" } };
    const parsed = parseSessionEvent(event);
    expect(parsed.kind).toBe("thinking");
    expect(parsed.summary).toContain("Thinking about it");
  });
});
