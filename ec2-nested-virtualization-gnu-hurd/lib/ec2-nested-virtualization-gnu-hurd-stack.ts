import { CfnOutput, CustomResource, Duration, Fn, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

export class Ec2NestedVirtualizationGnuHurdStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'NestedVirtVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: true,
        },
      ],
    });

    const securityGroup = new ec2.SecurityGroup(this, 'NestedVirtSecurityGroup', {
      vpc,
      description: 'Session Manager only. No inbound access.',
      allowAllOutbound: true,
    });

    const instanceRole = new iam.Role(this, 'NestedVirtRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    );

    const instanceProfile = new iam.CfnInstanceProfile(this, 'NestedVirtInstanceProfile', {
      roles: [instanceRole.roleName],
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update',
      'apt-get install -y qemu-kvm qemu-utils qemu-system-x86 libvirt-daemon-system libvirt-clients virtinst curl tmux',
      'systemctl enable --now libvirtd || systemctl enable --now virtqemud || true',
      'id -u ubuntu >/dev/null 2>&1 && usermod -aG libvirt,kvm ubuntu || true',
      'mkdir -p /opt/gnu-hurd',
      "cat <<'EOF' >/usr/local/bin/check-kvm.sh",
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'echo "=== KVM / nested virtualization check ==="',
      'if [[ ! -e /dev/kvm ]]; then',
      '  echo "/dev/kvm not found. Nested virtualization might not be enabled." >&2',
      '  exit 1',
      'fi',
      'echo "/dev/kvm: OK"',
      'if [[ -f /sys/module/kvm_intel/parameters/nested ]]; then',
      '  echo -n "kvm_intel nested = "',
      '  cat /sys/module/kvm_intel/parameters/nested',
      'elif [[ -f /sys/module/kvm_amd/parameters/nested ]]; then',
      '  echo -n "kvm_amd nested = "',
      '  cat /sys/module/kvm_amd/parameters/nested',
      'else',
      '  echo "nested parameter was not found." >&2',
      'fi',
      'echo "KVM can be used by: $(id -un)"',
      'EOF',
      'chmod +x /usr/local/bin/check-kvm.sh',
      "cat <<'EOF' >/usr/local/bin/prepare-gnu-hurd.sh",
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'WORKDIR="/opt/gnu-hurd"',
      'ISO_PATH="${WORKDIR}/gnu-hurd-netinst.iso"',
      'DISK_PATH="${WORKDIR}/gnu-hurd.qcow2"',
      'DISK_SIZE_GB="${DISK_SIZE_GB:-20}"',
      '',
      'mkdir -p "${WORKDIR}"',
      'echo "Place GNU Hurd ISO at ${ISO_PATH} manually (download is not automated)."',
      '',
      'if [[ ! -f "${DISK_PATH}" ]]; then',
      '  qemu-img create -f qcow2 "${DISK_PATH}" "${DISK_SIZE_GB}G"',
      'else',
      '  echo "Disk already exists: ${DISK_PATH}"',
      'fi',
      'EOF',
      'chmod +x /usr/local/bin/prepare-gnu-hurd.sh',
      "cat <<'EOF' >/usr/local/bin/run-gnu-hurd.sh",
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'WORKDIR="/opt/gnu-hurd"',
      'ISO_PATH="${WORKDIR}/gnu-hurd-netinst.iso"',
      'DISK_PATH="${WORKDIR}/gnu-hurd.qcow2"',
      'DISK_SIZE_GB="${DISK_SIZE_GB:-20}"',
      'RAM_MB="${RAM_MB:-2048}"',
      'VCPUS="${VCPUS:-2}"',
      'VNC_DISPLAY="${VNC_DISPLAY:-1}"',
      '',
      'mkdir -p "${WORKDIR}"',
      '',
      'if [[ ! -e /dev/kvm ]]; then',
      '  echo "/dev/kvm is not available. Run /usr/local/bin/check-kvm.sh first." >&2',
      '  exit 1',
      'fi',
      '',
      'if [[ ! -f "${ISO_PATH}" ]]; then',
      '  echo "GNU Hurd ISO not found: ${ISO_PATH}" >&2',
      '  echo "Download manually and place the file before running this script." >&2',
      '  exit 1',
      'fi',
      '',
      'if [[ ! -f "${DISK_PATH}" ]]; then',
      '  /usr/local/bin/prepare-gnu-hurd.sh',
      'fi',
      '',
      'echo "Launching GNU Hurd installer with VNC display :${VNC_DISPLAY} (TCP $((5900 + VNC_DISPLAY)))."',
      'echo "Use SSM port forwarding to access VNC safely without opening Security Group inbound rules."',
      'exec qemu-system-i386 \\',
      '  -enable-kvm \\',
      '  -cpu host \\',
      '  -machine pc \\',
      '  -m "${RAM_MB}" \\',
      '  -smp "${VCPUS}" \\',
      '  -drive file="${DISK_PATH}",format=qcow2,if=ide \\',
      '  -cdrom "${ISO_PATH}" \\',
      '  -boot order=d \\',
      '  -nic user,model=rtl8139 \\',
      '  -vnc "127.0.0.1:${VNC_DISPLAY}" \\',
      '  -monitor stdio',
      'EOF',
      'chmod +x /usr/local/bin/run-gnu-hurd.sh',
      '/usr/local/bin/prepare-gnu-hurd.sh || true',
    );
    const encodedUserData = Buffer.from(userData.render(), 'utf8').toString('base64');
    const nestedRunnerFunction = new lambda.Function(this, 'NestedVirtRunnerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/nested-virt-provider')),
    });
    nestedRunnerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:RunInstances', 'ec2:TerminateInstances', 'ec2:DescribeInstances', 'ec2:CreateTags'],
        resources: ['*'],
      }),
    );
    nestedRunnerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [instanceRole.roleArn],
      }),
    );

    const nestedRunnerProvider = new cr.Provider(this, 'NestedVirtRunnerProvider', {
      onEventHandler: nestedRunnerFunction,
    });

    const runInstance = new CustomResource(this, 'NestedVirtRunInstance', {
      serviceToken: nestedRunnerProvider.serviceToken,
      properties: {
        ImageId:
          '{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}',
        InstanceType: 'c8i.large',
        NestedVirtualization: 'enabled',
        SubnetId: vpc.publicSubnets[0].subnetId,
        SecurityGroupId: securityGroup.securityGroupId,
        InstanceProfileArn: instanceProfile.attrArn,
        UserDataBase64: encodedUserData,
        NameTag: 'ubuntu-nested-virtualization-host',
        RootVolumeSizeGiB: '30',
        MetadataHttpEndpoint: 'enabled',
        MetadataHttpTokens: 'required',
        AssociatePublicIpAddress: 'true',
      },
    });
    runInstance.node.addDependency(instanceProfile);

    const instanceId = runInstance.ref;

    new CfnOutput(this, 'InstanceId', {
      value: instanceId,
    });

    new CfnOutput(this, 'SsmStartSession', {
      value: Fn.join('', ['aws ssm start-session --target ', instanceId]),
    });

    new CfnOutput(this, 'SsmPortForwardVnc5901', {
      value: Fn.join('', [
        'aws ssm start-session --target ',
        instanceId,
        ` --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["5901"],"localPortNumber":["5901"]}'`,
      ]),
    });
  }
}
