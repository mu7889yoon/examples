import {
  CreateMicrovmAuthTokenCommand,
  LambdaMicrovmsClient,
  GetMicrovmCommand,
  RunMicrovmCommand,
  TerminateMicrovmCommand,
} from '@aws-sdk/client-lambda-microvms';
import type { MicroVm, MicroVmService, RunMicrovmInput } from './types.js';

/** Thin adapter so the controller can be tested without AWS credentials. */
export class AwsMicroVmService implements MicroVmService {
  constructor(private readonly client: LambdaMicrovmsClient = new LambdaMicrovmsClient({})) {}

  async run(input: RunMicrovmInput): Promise<MicroVm> {
    const result = await this.client.send(new RunMicrovmCommand({
      imageIdentifier: input.imageIdentifier,
      imageVersion: input.imageVersion,
      executionRoleArn: input.executionRoleArn,
      maximumDurationInSeconds: input.maximumDurationInSeconds,
      clientToken: input.clientToken,
      runHookPayload: input.runHookPayload,
    })) as unknown as { microvmId?: string; state?: string; endpoint?: string };
    if (!result.microvmId) throw new Error('RunMicrovm returned no microvmId');
    return { id: result.microvmId, state: result.state ?? 'PENDING', endpoint: result.endpoint };
  }

  async get(id: string): Promise<MicroVm> {
    const result = await this.client.send(new GetMicrovmCommand({ microvmIdentifier: id })) as unknown as { microvmId?: string; state?: string; endpoint?: string };
    if (!result.microvmId) throw new Error('GetMicrovm returned no microvmId');
    return { id: result.microvmId, state: result.state ?? 'UNKNOWN', endpoint: result.endpoint };
  }

  async terminate(id: string): Promise<void> {
    await this.client.send(new TerminateMicrovmCommand({ microvmIdentifier: id }));
  }

  async createAuthToken(id: string, expirationMinutes: number, port = 8080): Promise<string> {
    const result = await this.client.send(new CreateMicrovmAuthTokenCommand({
      microvmIdentifier: id,
      expirationInMinutes: expirationMinutes,
      allowedPorts: [{ port }],
    })) as unknown as { authToken?: Record<string, string> };
    const token = result.authToken?.['X-aws-proxy-auth'];
    if (!token) throw new Error('CreateMicrovmAuthToken returned no X-aws-proxy-auth token');
    return token;
  }
}

export class FakeMicroVmService implements MicroVmService {
  readonly vms = new Map<string, MicroVm>();
  nextId = 0;
  runCalls = 0;
  terminateCalls: string[] = [];
  authToken = 'fake-token';
  async run(_: RunMicrovmInput): Promise<MicroVm> {
    this.runCalls++;
    const vm = { id: `fake-vm-${++this.nextId}`, state: 'RUNNING', endpoint: 'https://fake-microvm.test' };
    this.vms.set(vm.id, vm);
    return vm;
  }
  async get(id: string): Promise<MicroVm> {
    const vm = this.vms.get(id);
    if (!vm) throw new Error(`unknown fake microvm: ${id}`);
    return vm;
  }
  async terminate(id: string): Promise<void> {
    this.terminateCalls.push(id);
    const vm = this.vms.get(id);
    if (vm) vm.state = 'TERMINATED';
  }
  async createAuthToken(_: string, __: number, ___ = 8080): Promise<string> { return this.authToken; }
}
