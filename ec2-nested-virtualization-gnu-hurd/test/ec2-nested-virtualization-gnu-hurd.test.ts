import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Ec2NestedVirtualizationGnuHurdStack } from '../lib/ec2-nested-virtualization-gnu-hurd-stack';

test('Instance launch request enables nested virtualization on c8i.large', () => {
  const app = new cdk.App();
  const stack = new Ec2NestedVirtualizationGnuHurdStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::EC2::LaunchTemplate', 0);
  const templateString = JSON.stringify(template.toJSON());
  expect(templateString).toContain('runInstances');
  expect(templateString).toContain('InstanceType');
  expect(templateString).toContain('c8i.large');
  expect(templateString).toContain('NestedVirtualization');
  expect(templateString).toContain('enabled');

  template.hasResourceProperties('AWS::EC2::SecurityGroup', {
    GroupDescription: 'Session Manager only. No inbound access.',
    SecurityGroupIngress: Match.absent(),
  });
});
