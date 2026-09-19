import { ConditionalCheckFailed, type MicroVmService, type RunMicrovmInput, type SessionRecord, type SessionRepository, type SessionState } from './types.js';

export class FakeMicroVmService implements MicroVmService {
  readonly vms = new Map<string, { id: string; state: string; endpoint: string }>();
  nextId = 0; runCalls = 0; terminateCalls: string[] = []; authToken = 'fake-token';
  async run(_: RunMicrovmInput) { this.runCalls++; const vm = { id: `fake-vm-${++this.nextId}`, state: 'RUNNING', endpoint: 'https://fake-microvm.test' }; this.vms.set(vm.id, vm); return vm; }
  async get(id: string) { const vm = this.vms.get(id); if (!vm) throw new Error(`unknown fake microvm: ${id}`); return vm; }
  async terminate(id: string) { this.terminateCalls.push(id); const vm = this.vms.get(id); if (vm) vm.state = 'TERMINATED'; }
  async createAuthToken(_: string, __: number, ___?: number) { return this.authToken; }
}

export class MemorySessionRepository implements SessionRepository {
  readonly records = new Map<string, SessionRecord>();
  async create(record: SessionRecord) { if (this.records.has(record.sessionId)) throw new ConditionalCheckFailed(); this.records.set(record.sessionId, structuredClone(record)); }
  async get(id: string) { const r = this.records.get(id); return r ? structuredClone(r) : undefined; }
  async update(record: SessionRecord) { this.records.set(record.sessionId, structuredClone(record)); }
  async updateState(id: string, state: SessionState, patch: Partial<SessionRecord> = {}, expected?: SessionState) { const r = this.records.get(id); if (!r || (expected && r.state !== expected)) throw new ConditionalCheckFailed(); Object.assign(r, patch, { state, updatedAt: new Date().toISOString() }); return structuredClone(r); }
  async acquireJudge(id: string, requestId: string) { const r = this.records.get(id); if (!r || r.state !== 'RUNNING' || r.judgeLock) throw new ConditionalCheckFailed(); r.judgeLock = true; r.judgeRequestId = requestId; return structuredClone(r); }
  async releaseJudge(id: string, requestId: string) { const r = this.records.get(id); if (r?.judgeRequestId === requestId) { r.judgeLock = false; delete r.judgeRequestId; } }
}
