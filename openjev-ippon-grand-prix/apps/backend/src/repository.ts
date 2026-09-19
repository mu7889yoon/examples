import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailed, type SessionRecord, type SessionRepository, type SessionState } from './types.js';

export class DynamoSessionRepository implements SessionRepository {
  constructor(private readonly tableName: string, private readonly db = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {}

  async create(record: SessionRecord): Promise<void> {
    try {
      await this.db.send(new PutCommand({ TableName: this.tableName, Item: record, ConditionExpression: 'attribute_not_exists(sessionId)' }));
    } catch (error) { if (isConditional(error)) throw new ConditionalCheckFailed(); throw error; }
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const result = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { sessionId }, ConsistentRead: true })) as unknown as { Item?: Record<string, unknown> };
    return result.Item as SessionRecord | undefined;
  }

  async update(record: SessionRecord): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: record }));
  }

  async updateState(sessionId: string, state: SessionState, patch: Partial<SessionRecord> = {}, expected?: SessionState): Promise<SessionRecord> {
    const names: Record<string, string> = { '#state': 'state', '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':state': state, ':updatedAt': new Date().toISOString() };
    if (expected) values[':expected'] = expected;
    const sets = ['#state = :state', '#updatedAt = :updatedAt'];
    for (const [key, value] of Object.entries(patch)) { if (key === 'sessionId') continue; const n = `#${key}`; const v = `:${key}`; names[n] = key; values[v] = value; sets.push(`${n} = ${v}`); }
    try {
      const result = await this.db.send(new UpdateCommand({ TableName: this.tableName, Key: { sessionId }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ConditionExpression: expected ? '#state = :expected' : undefined, ReturnValues: 'ALL_NEW' })) as unknown as { Attributes?: Record<string, unknown> };
      return result.Attributes as unknown as SessionRecord;
    } catch (error) { if (isConditional(error)) throw new ConditionalCheckFailed(); throw error; }
  }

  async acquireJudge(sessionId: string, requestId: string): Promise<SessionRecord> {
    try {
      const result = await this.db.send(new UpdateCommand({
        TableName: this.tableName, Key: { sessionId },
        UpdateExpression: 'SET #lock = :true, judgeRequestId = :requestId, updatedAt = :now',
        ExpressionAttributeNames: { '#lock': 'judgeLock', '#state': 'state' },
        ExpressionAttributeValues: { ':true': true, ':false': false, ':requestId': requestId, ':running': 'RUNNING', ':now': new Date().toISOString() },
        ConditionExpression: '#state = :running AND (attribute_not_exists(#lock) OR #lock = :false)', ReturnValues: 'ALL_NEW',
      })) as unknown as { Attributes?: Record<string, unknown> };
      return result.Attributes as unknown as SessionRecord;
    } catch (error) { if (isConditional(error)) throw new ConditionalCheckFailed('session is not RUNNING or already judging'); throw error; }
  }

  async releaseJudge(sessionId: string, requestId: string): Promise<void> {
    try {
      await this.db.send(new UpdateCommand({ TableName: this.tableName, Key: { sessionId }, UpdateExpression: 'SET judgeLock = :false, updatedAt = :now REMOVE judgeRequestId', ExpressionAttributeValues: { ':false': false, ':now': new Date().toISOString(), ':requestId': requestId }, ConditionExpression: 'judgeRequestId = :requestId' }));
    } catch (error) { if (isConditional(error)) return; throw error; }
  }
}

function isConditional(error: unknown): boolean { return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'ConditionalCheckFailedException'; }

export class MemorySessionRepository implements SessionRepository {
  readonly records = new Map<string, SessionRecord>();
  async create(record: SessionRecord): Promise<void> { if (this.records.has(record.sessionId)) throw new ConditionalCheckFailed(); this.records.set(record.sessionId, structuredClone(record)); }
  async get(id: string): Promise<SessionRecord | undefined> { const r = this.records.get(id); return r ? structuredClone(r) : undefined; }
  async update(record: SessionRecord): Promise<void> { this.records.set(record.sessionId, structuredClone(record)); }
  async updateState(id: string, state: SessionState, patch: Partial<SessionRecord> = {}, expected?: SessionState): Promise<SessionRecord> { const r = this.records.get(id); if (!r || (expected && r.state !== expected)) throw new ConditionalCheckFailed(); Object.assign(r, patch, { state, updatedAt: new Date().toISOString() }); return structuredClone(r); }
  async acquireJudge(id: string, requestId: string): Promise<SessionRecord> { const r = this.records.get(id); if (!r || r.state !== 'RUNNING' || r.judgeLock) throw new ConditionalCheckFailed(); r.judgeLock = true; r.judgeRequestId = requestId; return structuredClone(r); }
  async releaseJudge(id: string, requestId: string): Promise<void> { const r = this.records.get(id); if (r?.judgeRequestId === requestId) { r.judgeLock = false; delete r.judgeRequestId; } }
}
