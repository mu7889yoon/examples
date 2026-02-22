import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Ec2NestedVirtualizationGnuHurdStack } from '../lib/ec2-nested-virtualization-gnu-hurd-stack';

test('Instance launch request enables nested virtualization on c8i.large', () => {
  const app = new cdk.App();
  const stack = new Ec2NestedVirtualizationGnuHurdStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::EC2::LaunchTemplate', 0);
  template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
  template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
    InstanceType: 'c8i.large',
    NestedVirtualization: 'enabled',
    ImageId:
      '{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}',
  });

  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    GroupDescription: 'Session Manager only. No inbound access.',
    SecurityGroupIngress: Match.absent(),
  });
});
