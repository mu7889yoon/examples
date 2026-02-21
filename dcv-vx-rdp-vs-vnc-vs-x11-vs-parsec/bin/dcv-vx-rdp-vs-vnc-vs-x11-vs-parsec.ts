#!/usr/bin/env node
import { execSync } from 'node:child_process';
import * as cdk from 'aws-cdk-lib';
import {
  DcvVxRdpVsVncVsX11VsParsecStack,
} from '../lib/dcv-vx-rdp-vs-vnc-vs-x11-vs-parsec-stack';
import { DEFAULT_PROTOCOL_PORTS } from '../lib/config';

const app = new cdk.App();
const defaultSynthCidr = '203.0.113.10/32';

function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function detectPublicIpv4(): string | undefined {
  const envIp = process.env.MY_IP?.trim();
  if (envIp && isValidIpv4(envIp)) {
    return envIp;
  }

  try {
    const detected = execSync(
      "curl -s https://checkip.amazonaws.com | tr -d '\\n'",
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      },
    )
      .toString('utf8')
      .trim();
    if (isValidIpv4(detected)) {
      return detected;
    }
  } catch {
    // no-op
  }

  return undefined;
}

function parseNumberContext(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Context value "${value}" is not a number.`);
  }
  return parsed;
}

const allowedClientCidr = app.node.tryGetContext('allowedClientCidr') as
  | string
  | undefined;
const autoDetectedIp = detectPublicIpv4();
const autoDetectedCidr = autoDetectedIp ? `${autoDetectedIp}/32` : undefined;
const effectiveAllowedClientCidr =
  allowedClientCidr ?? autoDetectedCidr ?? defaultSynthCidr;

if (!allowedClientCidr && autoDetectedCidr) {
  console.warn(
    `Context "allowedClientCidr" is not set. Auto-detected and using ${autoDetectedCidr}.`,
  );
}
if (!allowedClientCidr && !autoDetectedCidr) {
  console.warn(
    `Context "allowedClientCidr" is not set and auto-detection failed. Using default ${defaultSynthCidr}.`,
  );
}

new DcvVxRdpVsVncVsX11VsParsecStack(
  app,
  'DcvVxRdpVsVncVsX11VsParsecStack',
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: 'ap-northeast-1',
    },
    benchmarkConfig: {
      allowedClientCidr: effectiveAllowedClientCidr,
      windowsInstanceType: app.node.tryGetContext('windowsInstanceType'),
      linuxInstanceType: app.node.tryGetContext('linuxInstanceType'),
      ports: {
        dcvPort: parseNumberContext(
          app.node.tryGetContext('dcvPort'),
          DEFAULT_PROTOCOL_PORTS.dcvPort,
        ),
        rdpPort: parseNumberContext(
          app.node.tryGetContext('rdpPort'),
          DEFAULT_PROTOCOL_PORTS.rdpPort,
        ),
        vncPort: parseNumberContext(
          app.node.tryGetContext('vncPort'),
          DEFAULT_PROTOCOL_PORTS.vncPort,
        ),
        sshPort: parseNumberContext(
          app.node.tryGetContext('sshPort'),
          DEFAULT_PROTOCOL_PORTS.sshPort,
        ),
        parsecTcpPort: parseNumberContext(
          app.node.tryGetContext('parsecTcpPort'),
          DEFAULT_PROTOCOL_PORTS.parsecTcpPort,
        ),
        parsecUdpFrom: parseNumberContext(
          app.node.tryGetContext('parsecUdpFrom'),
          DEFAULT_PROTOCOL_PORTS.parsecUdpFrom,
        ),
        parsecUdpTo: parseNumberContext(
          app.node.tryGetContext('parsecUdpTo'),
          DEFAULT_PROTOCOL_PORTS.parsecUdpTo,
        ),
      },
    },
  },
);
