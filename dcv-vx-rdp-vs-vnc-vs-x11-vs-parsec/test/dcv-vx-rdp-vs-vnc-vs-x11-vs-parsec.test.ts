import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DcvVxRdpVsVncVsX11VsParsecStack } from '../lib/dcv-vx-rdp-vs-vnc-vs-x11-vs-parsec-stack';

function createTemplate(): Template {
  const app = new cdk.App();
  const stack = new DcvVxRdpVsVncVsX11VsParsecStack(app, 'TestStack', {
    benchmarkConfig: {
      allowedClientCidr: '203.0.113.10/32',
    },
  });
  return Template.fromStack(stack);
}

test('required benchmark resources are created', () => {
  const template = createTemplate();

  template.resourceCountIs('AWS::EC2::Instance', 2);
  template.resourceCountIs('AWS::EC2::EIP', 2);
  template.resourceCountIs('AWS::EC2::SecurityGroup', 2);

  template.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 'g4dn.xlarge' });

  const rendered = template.toJSON() as {
    Parameters?: Record<string, { Default?: string }>;
  };
  const parameterDefaults = Object.values(rendered.Parameters ?? {}).map(
    (parameter) => parameter.Default,
  );
  expect(parameterDefaults).toContain(
    '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
  );
  expect(parameterDefaults).toContain(
    '/aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base',
  );
});

test('waypipe outputs are present', () => {
  const template = createTemplate();

  template.hasOutput('WaypipeSshEndpointLinux', {});
  template.hasOutput('WaypipeCommandHint', {});
});

test('security group ingress is restricted to allowed CIDR and required ports', () => {
  const template = createTemplate();
  const securityGroups = template.findResources('AWS::EC2::SecurityGroup') as Record<
    string,
    {
      Properties: {
        SecurityGroupIngress?: Array<{
          CidrIp?: string;
          FromPort?: number;
          ToPort?: number;
          IpProtocol?: string;
        }>;
      };
    }
  >;

  const ingressList = Object.values(securityGroups).flatMap(
    (securityGroup) => securityGroup.Properties.SecurityGroupIngress ?? [],
  );
  expect(ingressList.length).toBeGreaterThan(0);

  for (const ingress of ingressList) {
    expect(ingress.CidrIp).toBe('203.0.113.10/32');
  }

  const signatures = ingressList.map((ingress) => ({
    from: ingress.FromPort,
    to: ingress.ToPort,
    protocol: ingress.IpProtocol,
  }));

  expect(signatures).toEqual(
    expect.arrayContaining([
      { from: 22, to: 22, protocol: 'tcp' },
      { from: 3389, to: 3389, protocol: 'tcp' },
      { from: 5900, to: 5900, protocol: 'tcp' },
      { from: 8443, to: 8443, protocol: 'tcp' },
      { from: 8443, to: 8443, protocol: 'udp' },
      { from: 9000, to: 9000, protocol: 'tcp' },
      { from: 8000, to: 8010, protocol: 'udp' },
    ]),
  );
});
