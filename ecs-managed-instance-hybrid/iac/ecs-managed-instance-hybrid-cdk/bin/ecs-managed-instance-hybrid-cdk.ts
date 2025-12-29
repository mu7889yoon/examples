#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { EcsManagedInstanceHybridCdkStack } from '../lib/ecs-managed-instance-hybrid-cdk-stack';

const app = new cdk.App();
new EcsManagedInstanceHybridCdkStack(app, 'EcsManagedInstanceHybridCdkStack', {
  env: { region: 'us-east-1' },
});
