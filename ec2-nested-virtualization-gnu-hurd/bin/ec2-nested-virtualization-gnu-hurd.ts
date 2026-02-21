#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Ec2NestedVirtualizationGnuHurdStack } from '../lib/ec2-nested-virtualization-gnu-hurd-stack';

const app = new cdk.App();
new Ec2NestedVirtualizationGnuHurdStack(app, 'Ec2NestedVirtualizationGnuHurdStack', {
  env: {
    region: 'us-east-1',
  },
});
