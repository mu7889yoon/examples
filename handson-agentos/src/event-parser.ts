import type { EventKind, ParsedEvent } from "./types.js";

// ── Method → EventKind mapping table ─────────────────────────────
// Centralized in one place for easy updates when Agent OS version changes.

const METHOD_KIND_MAP: ReadonlyArray<{ pattern: RegExp; kind: EventKind }> = [
  // File write events
  { pattern: /write|file_write|create_file|save_file/i, kind: "file_write" },
  // Command execution events
  { pattern: /exec|command|run|shell|terminal/i, kind: "command_exec" },
  // Thinking / text generation events
  { pattern: /think|text|generat|stream|message|content/i, kind: "thinking" },
];

const KIND_ICON: Record<EventKind, string> = {
  thinking: "💭",
  file_write: "📝",
  command_exec: "▶",
  tool_call: "🔧",
};

// ── parseSessionEvent ────────────────────────────────────────────

export function parseSessionEvent(event: {
  method: string;
  params: any;
}): ParsedEvent {
  const kind = resolveKind(event.method);
  const icon = KIND_ICON[kind];
  const summary = buildSummary(kind, icon, event);

  return {
    kind,
    icon,
    summary,
    timestamp: Date.now(),
    raw: event,
  };
}

function resolveKind(method: string): EventKind {
  for (const entry of METHOD_KIND_MAP) {
    if (entry.pattern.test(method)) {
      return entry.kind;
    }
  }
  // Anything that doesn't match a known pattern is a generic tool call
  return "tool_call";
}

function buildSummary(
  kind: EventKind,
  icon: string,
  event: { method: string; params: any },
): string {
  const params = event.params ?? {};

  switch (kind) {
    case "thinking": {
      const text =
        typeof params.text === "string"
          ? params.text
          : typeof params.content === "string"
            ? params.content
            : "";
      return `${icon} ${truncateThought(text)}`;
    }
    case "file_write": {
      const filename =
        typeof params.path === "string"
          ? params.path.split("/").pop() ?? params.path
          : typeof params.filename === "string"
            ? params.filename
            : event.method;
      return `${icon} ${filename}`;
    }
    case "command_exec": {
      const cmd =
        typeof params.command === "string"
          ? params.command
          : typeof params.cmd === "string"
            ? params.cmd
            : event.method;
      return `${icon} ${truncateThought(cmd)}`;
    }
    case "tool_call": {
      const toolName =
        typeof params.name === "string" ? params.name : event.method;
      return `${icon} ${toolName}`;
    }
  }
}

// ── truncateThought ──────────────────────────────────────────────

const DEFAULT_MAX_LEN = 80;

export function truncateThought(text: string, maxLen: number = DEFAULT_MAX_LEN): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen - 1) + "…";
}
