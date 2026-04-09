import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseMemoryOutput,
  calculateMetricsSummary,
  startMetricsCollection,
} from "../metrics-collector.js";
import type { MemorySnapshot } from "../types.js";

// ── parseMemoryOutput ────────────────────────────────────────────

describe("parseMemoryOutput", () => {
  it("parses valid free -m output", () => {
    const stdout = [
      "              total        used        free      shared  buff/cache   available",
      "Mem:            512         128         256          0         128         384",
      "Swap:             0           0           0",
    ].join("\n");

    const result = parseMemoryOutput(stdout);
    expect(result).not.toBeNull();
    expect(result!.totalMB).toBe(512);
    expect(result!.usedMB).toBe(128);
    expect(result!.freeMB).toBe(256);
    expect(result!.availableMB).toBe(384);
  });

  it("returns null for empty string", () => {
    expect(parseMemoryOutput("")).toBeNull();
  });

  it("returns null when Mem: line is missing", () => {
    const stdout = [
      "              total        used        free      shared  buff/cache   available",
      "Swap:             0           0           0",
    ].join("\n");
    expect(parseMemoryOutput(stdout)).toBeNull();
  });

  it("returns null when Mem: line has too few columns", () => {
    const stdout = "Mem:   512   128";
    expect(parseMemoryOutput(stdout)).toBeNull();
  });

  it("returns null when values are not numbers", () => {
    const stdout =
      "Mem:   abc   def   ghi   0   jkl   mno";
    expect(parseMemoryOutput(stdout)).toBeNull();
  });

  it("handles large memory values", () => {
    const stdout = [
      "              total        used        free      shared  buff/cache   available",
      "Mem:          65536       32768       16384          0       16384       49152",
    ].join("\n");

    const result = parseMemoryOutput(stdout);
    expect(result).not.toBeNull();
    expect(result!.totalMB).toBe(65536);
    expect(result!.usedMB).toBe(32768);
    expect(result!.freeMB).toBe(16384);
    expect(result!.availableMB).toBe(49152);
  });

  it("sets a timestamp on the result", () => {
    const stdout = [
      "              total        used        free      shared  buff/cache   available",
      "Mem:            512         128         256          0         128         384",
    ].join("\n");

    const before = Date.now();
    const result = parseMemoryOutput(stdout);
    const after = Date.now();

    expect(result!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.timestamp).toBeLessThanOrEqual(after);
  });
});

// ── calculateMetricsSummary ──────────────────────────────────────

describe("calculateMetricsSummary", () => {
  it("calculates peak and average for multiple snapshots", () => {
    const snapshots: MemorySnapshot[] = [
      { timestamp: 1, totalMB: 512, usedMB: 100, freeMB: 412, availableMB: 412 },
      { timestamp: 2, totalMB: 512, usedMB: 200, freeMB: 312, availableMB: 312 },
      { timestamp: 3, totalMB: 512, usedMB: 150, freeMB: 362, availableMB: 362 },
    ];

    const metrics = calculateMetricsSummary(snapshots, 1);
    expect(metrics.agentId).toBe(1);
    expect(metrics.peakUsedMB).toBe(200);
    expect(metrics.avgUsedMB).toBe(150);
    expect(metrics.snapshots).toBe(snapshots);
  });

  it("handles a single snapshot", () => {
    const snapshots: MemorySnapshot[] = [
      { timestamp: 1, totalMB: 512, usedMB: 256, freeMB: 256, availableMB: 256 },
    ];

    const metrics = calculateMetricsSummary(snapshots, 3);
    expect(metrics.peakUsedMB).toBe(256);
    expect(metrics.avgUsedMB).toBe(256);
  });

  it("returns zeros for empty snapshots", () => {
    const metrics = calculateMetricsSummary([], 5);
    expect(metrics.peakUsedMB).toBe(0);
    expect(metrics.avgUsedMB).toBe(0);
    expect(metrics.snapshots).toEqual([]);
  });
});

// ── startMetricsCollection ───────────────────────────────────────

describe("startMetricsCollection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collects metrics at the specified interval", async () => {
    const freeOutput = [
      "              total        used        free      shared  buff/cache   available",
      "Mem:            512         128         256          0         128         384",
    ].join("\n");

    const mockVm = {
      exec: vi.fn().mockResolvedValue({ stdout: freeOutput }),
    };

    const collector = startMetricsCollection(mockVm, 1, 100);

    // Initial collection fires immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(mockVm.exec).toHaveBeenCalledTimes(1);

    // Advance past one interval
    await vi.advanceTimersByTimeAsync(100);
    expect(mockVm.exec).toHaveBeenCalledTimes(2);

    // Advance past another interval
    await vi.advanceTimersByTimeAsync(100);
    expect(mockVm.exec).toHaveBeenCalledTimes(3);

    const metrics = collector.stop();
    expect(metrics.agentId).toBe(1);
    expect(metrics.snapshots.length).toBe(3);
    expect(metrics.peakUsedMB).toBe(128);
    expect(metrics.avgUsedMB).toBe(128);
  });

  it("uses default interval of 5000ms", async () => {
    const freeOutput = [
      "              total        used        free      shared  buff/cache   available",
      "Mem:            512         128         256          0         128         384",
    ].join("\n");

    const mockVm = {
      exec: vi.fn().mockResolvedValue({ stdout: freeOutput }),
    };

    const collector = startMetricsCollection(mockVm, 2);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockVm.exec).toHaveBeenCalledTimes(1);

    // Not yet at 5000ms
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockVm.exec).toHaveBeenCalledTimes(1);

    // At 5000ms
    await vi.advanceTimersByTimeAsync(1);
    expect(mockVm.exec).toHaveBeenCalledTimes(2);

    collector.stop();
  });

  it("stops collecting after stop() is called", async () => {
    const freeOutput = [
      "              total        used        free      shared  buff/cache   available",
      "Mem:            512         128         256          0         128         384",
    ].join("\n");

    const mockVm = {
      exec: vi.fn().mockResolvedValue({ stdout: freeOutput }),
    };

    const collector = startMetricsCollection(mockVm, 1, 100);
    await vi.advanceTimersByTimeAsync(0);

    collector.stop();

    // Advance time — no more calls should happen
    await vi.advanceTimersByTimeAsync(500);
    expect(mockVm.exec).toHaveBeenCalledTimes(1);
  });

  it("handles exec failures gracefully (requirement 8.5)", async () => {
    const mockVm = {
      exec: vi.fn().mockRejectedValue(new Error("VM not available")),
    };

    const collector = startMetricsCollection(mockVm, 4, 100);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    const metrics = collector.stop();
    expect(metrics.snapshots).toEqual([]);
    expect(metrics.peakUsedMB).toBe(0);
    expect(metrics.avgUsedMB).toBe(0);
  });

  it("ignores unparseable output", async () => {
    const mockVm = {
      exec: vi.fn().mockResolvedValue({ stdout: "garbage output" }),
    };

    const collector = startMetricsCollection(mockVm, 3, 100);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    const metrics = collector.stop();
    expect(metrics.snapshots).toEqual([]);
  });
});
