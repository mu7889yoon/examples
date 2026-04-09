import type { MemorySnapshot, VMMetrics } from "./types.js";

/**
 * Parse `free -m` stdout into a MemorySnapshot.
 * Returns null if the output cannot be parsed.
 */
export function parseMemoryOutput(stdout: string): MemorySnapshot | null {
  const lines = stdout.split("\n");
  const memLine = lines.find((line) => line.startsWith("Mem:"));
  if (!memLine) return null;

  const parts = memLine.trim().split(/\s+/);
  // Expected: ["Mem:", total, used, free, shared, buff/cache, available]
  if (parts.length < 7) return null;

  const total = parseInt(parts[1], 10);
  const used = parseInt(parts[2], 10);
  const free = parseInt(parts[3], 10);
  const available = parseInt(parts[6], 10);

  if ([total, used, free, available].some((v) => Number.isNaN(v))) return null;

  return {
    timestamp: Date.now(),
    totalMB: total,
    usedMB: used,
    freeMB: free,
    availableMB: available,
  };
}

/**
 * Calculate peak and average usedMB from a list of snapshots.
 */
export function calculateMetricsSummary(
  snapshots: MemorySnapshot[],
  agentId: number,
): VMMetrics {
  if (snapshots.length === 0) {
    return { agentId, snapshots, peakUsedMB: 0, avgUsedMB: 0 };
  }

  const peakUsedMB = Math.max(...snapshots.map((s) => s.usedMB));
  const avgUsedMB =
    snapshots.reduce((sum, s) => sum + s.usedMB, 0) / snapshots.length;

  return { agentId, snapshots, peakUsedMB, avgUsedMB };
}

/**
 * Start periodic memory metrics collection on a VM.
 * Returns an object with a `stop()` method that stops collection and returns VMMetrics.
 */
export function startMetricsCollection(
  vm: any,
  agentId: number,
  intervalMs: number = 5000,
): { stop: () => VMMetrics } {
  const snapshots: MemorySnapshot[] = [];
  let stopped = false;

  const collect = async () => {
    try {
      const { stdout } = await vm.exec("free -m");
      const snapshot = parseMemoryOutput(stdout);
      if (snapshot && !stopped) {
        snapshots.push(snapshot);
      }
    } catch {
      // Requirement 8.5: if memory info retrieval fails, continue silently
    }
  };

  // Fire initial collection immediately
  collect();

  const timer = setInterval(() => {
    if (!stopped) collect();
  }, intervalMs);

  return {
    stop(): VMMetrics {
      stopped = true;
      clearInterval(timer);
      return calculateMetricsSummary(snapshots, agentId);
    },
  };
}
