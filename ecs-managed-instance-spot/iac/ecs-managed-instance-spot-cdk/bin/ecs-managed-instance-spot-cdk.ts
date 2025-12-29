#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { EcsManagedInstanceSpotCdkStack } from '../lib/ecs-managed-instance-spot-cdk-stack';

const app = new cdk.App();
new EcsManagedInstanceSpotCdkStack(app, 'EcsManagedInstanceSpotCdkStack', {
  env: { region: 'us-east-1' },
});
