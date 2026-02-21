export interface ProtocolPorts {
  readonly dcvPort: number;
  readonly rdpPort: number;
  readonly vncPort: number;
  readonly sshPort: number;
  readonly parsecTcpPort: number;
  readonly parsecUdpFrom: number;
  readonly parsecUdpTo: number;
}

export interface BenchmarkConfig {
  readonly allowedClientCidr: string;
  readonly windowsInstanceType: string;
  readonly linuxInstanceType: string;
  readonly ports: ProtocolPorts;
}

export interface BenchmarkConfigInput {
  readonly allowedClientCidr?: string;
  readonly windowsInstanceType?: unknown;
  readonly linuxInstanceType?: unknown;
  readonly ports?: {
    readonly dcvPort?: unknown;
    readonly rdpPort?: unknown;
    readonly vncPort?: unknown;
    readonly sshPort?: unknown;
    readonly parsecTcpPort?: unknown;
    readonly parsecUdpFrom?: unknown;
    readonly parsecUdpTo?: unknown;
  };
}

export const DEFAULT_PROTOCOL_PORTS: ProtocolPorts = {
  dcvPort: 8443,
  rdpPort: 3389,
  vncPort: 5900,
  sshPort: 22,
  parsecTcpPort: 9000,
  parsecUdpFrom: 8000,
  parsecUdpTo: 8010,
};

export const DEFAULT_INSTANCE_TYPE = 'g4dn.xlarge';

function toPort(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port value: ${value}`);
  }
  return parsed;
}

function toInstanceType(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

export function resolveBenchmarkConfig(
  input: BenchmarkConfigInput | undefined,
): BenchmarkConfig {
  const allowedClientCidr = input?.allowedClientCidr?.trim();
  if (!allowedClientCidr) {
    throw new Error(
      'allowedClientCidr is required. Example: 203.0.113.10/32',
    );
  }

  const portsInput = input?.ports;
  const parsecUdpFrom = toPort(
    portsInput?.parsecUdpFrom,
    DEFAULT_PROTOCOL_PORTS.parsecUdpFrom,
  );
  const parsecUdpTo = toPort(
    portsInput?.parsecUdpTo,
    DEFAULT_PROTOCOL_PORTS.parsecUdpTo,
  );
  if (parsecUdpFrom > parsecUdpTo) {
    throw new Error('parsecUdpFrom must be less than or equal to parsecUdpTo.');
  }

  return {
    allowedClientCidr,
    windowsInstanceType:
      toInstanceType(input?.windowsInstanceType) ?? DEFAULT_INSTANCE_TYPE,
    linuxInstanceType:
      toInstanceType(input?.linuxInstanceType) ?? DEFAULT_INSTANCE_TYPE,
    ports: {
      dcvPort: toPort(portsInput?.dcvPort, DEFAULT_PROTOCOL_PORTS.dcvPort),
      rdpPort: toPort(portsInput?.rdpPort, DEFAULT_PROTOCOL_PORTS.rdpPort),
      vncPort: toPort(portsInput?.vncPort, DEFAULT_PROTOCOL_PORTS.vncPort),
      sshPort: toPort(portsInput?.sshPort, DEFAULT_PROTOCOL_PORTS.sshPort),
      parsecTcpPort: toPort(
        portsInput?.parsecTcpPort,
        DEFAULT_PROTOCOL_PORTS.parsecTcpPort,
      ),
      parsecUdpFrom,
      parsecUdpTo,
    },
  };
}
