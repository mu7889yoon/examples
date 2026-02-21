import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import {
  BenchmarkConfigInput,
  resolveBenchmarkConfig,
} from './config';

export interface DcvVxRdpVsVncVsX11VsParsecStackProps extends cdk.StackProps {
  readonly benchmarkConfig: BenchmarkConfigInput;
}

function addScriptToUserData(
  userData: ec2.UserData,
  scriptPath: string,
  stripShebang: boolean,
): void {
  const raw = fs.readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const normalized = stripShebang && lines[0]?.startsWith('#!')
    ? lines.slice(1)
    : lines;
  userData.addCommands(...normalized);
}

export class DcvVxRdpVsVncVsX11VsParsecStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: DcvVxRdpVsVncVsX11VsParsecStackProps,
  ) {
    super(scope, id, props);

    const config = resolveBenchmarkConfig(props.benchmarkConfig);
    const scriptRoot = path.resolve(__dirname, '..', 'assets');

    const vpc = new ec2.Vpc(this, 'BenchmarkVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const instanceRole = new iam.Role(this, 'BenchmarkInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore',
        ),
      ],
    });

    const allowedPeer = ec2.Peer.ipv4(config.allowedClientCidr);
    const windowsSg = new ec2.SecurityGroup(this, 'WindowsHostSg', {
      vpc,
      description: 'Ingress restricted to benchmark client CIDR',
      allowAllOutbound: true,
    });
    const linuxSg = new ec2.SecurityGroup(this, 'LinuxHostSg', {
      vpc,
      description: 'Ingress restricted to benchmark client CIDR',
      allowAllOutbound: true,
    });

    windowsSg.addIngressRule(
      allowedPeer,
      ec2.Port.tcp(config.ports.dcvPort),
      'DCV TCP',
    );
    windowsSg.addIngressRule(
      allowedPeer,
      ec2.Port.udp(config.ports.dcvPort),
      'DCV UDP',
    );
    windowsSg.addIngressRule(
      allowedPeer,
      ec2.Port.tcp(config.ports.rdpPort),
      'RDP TCP',
    );
    windowsSg.addIngressRule(
      allowedPeer,
      ec2.Port.tcp(config.ports.vncPort),
      'VNC TCP',
    );
    windowsSg.addIngressRule(
      allowedPeer,
      ec2.Port.tcp(config.ports.parsecTcpPort),
      'Parsec TCP',
    );
    windowsSg.addIngressRule(
      allowedPeer,
      ec2.Port.udpRange(config.ports.parsecUdpFrom, config.ports.parsecUdpTo),
      'Parsec UDP',
    );

    linuxSg.addIngressRule(
      allowedPeer,
      ec2.Port.tcp(config.ports.dcvPort),
      'DCV TCP',
    );
    linuxSg.addIngressRule(
      allowedPeer,
      ec2.Port.udp(config.ports.dcvPort),
      'DCV UDP',
    );
    linuxSg.addIngressRule(
      allowedPeer,
      ec2.Port.tcp(config.ports.vncPort),
      'VNC TCP',
    );
    linuxSg.addIngressRule(
      allowedPeer,
      ec2.Port.tcp(config.ports.sshPort),
      'SSH TCP',
    );

    const windowsUserData = ec2.UserData.forWindows();
    addScriptToUserData(
      windowsUserData,
      path.join(scriptRoot, 'windows', 'bootstrap.ps1'),
      false,
    );

    const linuxUserData = ec2.UserData.forLinux();
    addScriptToUserData(
      linuxUserData,
      path.join(scriptRoot, 'linux', 'bootstrap.sh'),
      true,
    );

    const windowsHost = new ec2.Instance(this, 'WindowsBenchmarkHost', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      role: instanceRole,
      securityGroup: windowsSg,
      instanceType: new ec2.InstanceType(config.windowsInstanceType),
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base',
        { os: ec2.OperatingSystemType.WINDOWS },
      ),
      userData: windowsUserData,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(200, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });
    cdk.Tags.of(windowsHost).add('Name', 'benchmark-windows-host');

    const linuxHost = new ec2.Instance(this, 'LinuxBenchmarkHost', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      role: instanceRole,
      securityGroup: linuxSg,
      instanceType: new ec2.InstanceType(config.linuxInstanceType),
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
        { os: ec2.OperatingSystemType.LINUX },
      ),
      userData: linuxUserData,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(200, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });
    cdk.Tags.of(linuxHost).add('Name', 'benchmark-linux-host');

    const windowsEip = new ec2.CfnEIP(this, 'WindowsHostEip', {
      domain: 'vpc',
    });
    new ec2.CfnEIPAssociation(this, 'WindowsHostEipAssociation', {
      allocationId: windowsEip.attrAllocationId,
      instanceId: windowsHost.instanceId,
    });

    const linuxEip = new ec2.CfnEIP(this, 'LinuxHostEip', {
      domain: 'vpc',
    });
    new ec2.CfnEIPAssociation(this, 'LinuxHostEipAssociation', {
      allocationId: linuxEip.attrAllocationId,
      instanceId: linuxHost.instanceId,
    });

    new cdk.CfnOutput(this, 'AllowedClientCidr', {
      value: config.allowedClientCidr,
    });
    new cdk.CfnOutput(this, 'WindowsHostPublicIp', { value: windowsEip.ref });
    new cdk.CfnOutput(this, 'LinuxHostPublicIp', { value: linuxEip.ref });

    new cdk.CfnOutput(this, 'DcvEndpointWindows', {
      value: `https://${windowsEip.ref}:${config.ports.dcvPort}`,
    });
    new cdk.CfnOutput(this, 'RdpEndpoint', {
      value: `${windowsEip.ref}:${config.ports.rdpPort}`,
    });
    new cdk.CfnOutput(this, 'VncEndpointWindows', {
      value: `${windowsEip.ref}:${config.ports.vncPort}`,
    });
    new cdk.CfnOutput(this, 'ParsecHostNote', {
      value: [
        'Parsec personal account requires manual final sign-in.',
        `Host=${windowsEip.ref}`,
        `TCP=${config.ports.parsecTcpPort}`,
        `UDP=${config.ports.parsecUdpFrom}-${config.ports.parsecUdpTo}`,
      ].join(' '),
    });

    new cdk.CfnOutput(this, 'DcvEndpointLinux', {
      value: `https://${linuxEip.ref}:${config.ports.dcvPort}`,
    });
    new cdk.CfnOutput(this, 'VncEndpointLinux', {
      value: `${linuxEip.ref}:${config.ports.vncPort}`,
    });
    new cdk.CfnOutput(this, 'SshEndpointLinux', {
      value: `${linuxEip.ref}:${config.ports.sshPort}`,
    });
    new cdk.CfnOutput(this, 'WaypipeSshEndpointLinux', {
      value: `${linuxEip.ref}:${config.ports.sshPort}`,
    });
    new cdk.CfnOutput(this, 'WaypipeCommandHint', {
      value: [
        'Client side waypipe command example:',
        `waypipe ssh ec2-user@${linuxEip.ref} /opt/run-waypipe-latency.sh`,
      ].join(' '),
    });
  }
}
