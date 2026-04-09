// ── AWS Credentials ──────────────────────────────────────────────

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
}

// ── App Config ───────────────────────────────────────────────────

export interface AppConfig {
  prompt: string;
  agentCount: number;
  awsCredentials: AWSCredentials;
  outputDir: string | null;
}

// ── Agent ────────────────────────────────────────────────────────

export type AgentStatus =
  | "waiting"
  | "thinking"
  | "coding"
  | "running"
  | "completed"
  | "error";

export interface AgentInstance {
  id: number;
  name: string;
  vm: any; // AgentOs — external type
  sessionId: string | null;
  status: AgentStatus;
  startTime: number;
  endTime: number | null;
}

// ── Results ──────────────────────────────────────────────────────

export interface AgentResult {
  agentId: number;
  agentName: string;
  code: string | null;
  language: string | null;
  filePath: string | null;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  error: string | null;
  elapsedMs: number;
  metrics: VMMetrics | null;
}

// ── Events ───────────────────────────────────────────────────────

export type EventKind = "thinking" | "file_write" | "command_exec" | "tool_call";

export interface ParsedEvent {
  kind: EventKind;
  icon: string;
  summary: string;
  timestamp: number;
  raw: unknown;
}

export interface AgentActivity {
  kind: EventKind;
  icon: string;
  summary: string;
  timestamp: number;
}

// ── UI State ─────────────────────────────────────────────────────

export type AppPhase = "initializing" | "running" | "completed";

export interface AgentState {
  id: number;
  name: string;
  color: string;
  status: AgentStatus;
  statusIcon: string;
  elapsedMs: number;
  activities: AgentActivity[];
  currentMemory: MemorySnapshot | null;
  codePreview: string | null;
}

// ── VM Metrics ───────────────────────────────────────────────────

export interface MemorySnapshot {
  timestamp: number;
  totalMB: number;
  usedMB: number;
  freeMB: number;
  availableMB: number;
}

export interface VMMetrics {
  agentId: number;
  snapshots: MemorySnapshot[];
  peakUsedMB: number;
  avgUsedMB: number;
}
