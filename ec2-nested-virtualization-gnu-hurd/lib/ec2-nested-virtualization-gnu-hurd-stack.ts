import { CfnOutput, Fn, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

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
      'dnf install -y qemu-kvm qemu-img qemu-system-x86 libvirt virt-install curl tmux',
      'systemctl enable --now libvirtd',
      'usermod -aG libvirt ec2-user',
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
      'ISO_URL="${1:-}"',
      'WORKDIR="/opt/gnu-hurd"',
      'ISO_PATH="${WORKDIR}/gnu-hurd-netinst.iso"',
      'DISK_PATH="${WORKDIR}/gnu-hurd.qcow2"',
      'DISK_SIZE_GB="${DISK_SIZE_GB:-20}"',
      '',
      'mkdir -p "${WORKDIR}"',
      '',
      'if [[ -z "${ISO_URL}" ]]; then',
      '  ISO_URL=$(curl -fsSL https://cdimage.debian.org/cdimage/ports/latest/hurd-i386/iso-cd/ \\',
      "    | grep -Eo 'href=\"[^\"]+NETINST[^\"/]+\\.iso\"' \\",
      "    | head -n1 \\",
      "    | sed -E 's#href=\"([^\"]+)\"#https://cdimage.debian.org/cdimage/ports/latest/hurd-i386/iso-cd/\\1#')",
      'fi',
      '',
      'if [[ -z "${ISO_URL}" ]]; then',
      '  echo "Could not resolve GNU Hurd ISO URL automatically. Pass URL as first argument." >&2',
      '  exit 1',
      'fi',
      '',
      'if [[ ! -f "${ISO_PATH}" ]]; then',
      '  echo "Downloading ${ISO_URL}"',
      '  curl -fL --retry 8 --retry-delay 5 --retry-connrefused "${ISO_URL}" -o "${ISO_PATH}"',
      'else',
      '  echo "ISO already exists: ${ISO_PATH}"',
      'fi',
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
      'ISO_URL="${1:-}"',
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
      'if [[ ! -f "${ISO_PATH}" || ! -f "${DISK_PATH}" ]]; then',
      '  /usr/local/bin/prepare-gnu-hurd.sh "${ISO_URL}"',
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
      '/usr/local/bin/prepare-gnu-hurd.sh',
    );

    const runInstance = new cr.AwsCustomResource(this, 'NestedVirtRunInstance', {
      installLatestAwsSdk: false,
      onCreate: {
        service: 'EC2',
        action: 'runInstances',
        physicalResourceId: cr.PhysicalResourceId.fromResponse('Instances.0.InstanceId'),
        outputPaths: ['Instances.0.InstanceId'],
        parameters: {
          ImageId: '{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}',
          InstanceType: 'c8i.large',
          MinCount: 1,
          MaxCount: 1,
          CpuOptions: {
            NestedVirtualization: 'enabled',
          },
          IamInstanceProfile: {
            Arn: instanceProfile.attrArn,
          },
          MetadataOptions: {
            HttpEndpoint: 'enabled',
            HttpTokens: 'required',
          },
          NetworkInterfaces: [
            {
              DeviceIndex: 0,
              SubnetId: vpc.publicSubnets[0].subnetId,
              AssociatePublicIpAddress: true,
              Groups: [securityGroup.securityGroupId],
              DeleteOnTermination: true,
            },
          ],
          BlockDeviceMappings: [
            {
              DeviceName: '/dev/xvda',
              Ebs: {
                VolumeType: 'gp3',
                VolumeSize: 30,
                DeleteOnTermination: true,
              },
            },
          ],
          UserData: Fn.base64(userData.render()),
          TagSpecifications: [
            {
              ResourceType: 'instance',
              Tags: [
                {
                  Key: 'Name',
                  Value: 'al2023-nested-virtualization-host',
                },
              ],
            },
          ],
        },
      },
      onDelete: {
        service: 'EC2',
        action: 'terminateInstances',
        outputPaths: ['TerminatingInstances.0.InstanceId'],
        parameters: {
          InstanceIds: [new cr.PhysicalResourceIdReference()],
        },
        ignoreErrorCodesMatching: 'InvalidInstanceID.NotFound|InvalidInstanceID.Malformed',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['ec2:RunInstances', 'ec2:TerminateInstances', 'ec2:DescribeInstances', 'ec2:CreateTags'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['iam:PassRole'],
          resources: [instanceRole.roleArn],
        }),
      ]),
    });
    runInstance.node.addDependency(instanceProfile);

    const instanceId = runInstance.getResponseField('Instances.0.InstanceId');

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
