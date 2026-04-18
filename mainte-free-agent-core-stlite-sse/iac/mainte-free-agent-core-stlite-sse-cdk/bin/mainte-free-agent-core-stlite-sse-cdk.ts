#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MainteFreeAgentCoreStliteSseCdkStack } from '../lib/mainte-free-agent-core-stlite-sse-cdk-stack';

const app = new cdk.App();
new MainteFreeAgentCoreStliteSseCdkStack(app, 'MainteFreeAgentCoreStliteSseCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  crossRegionReferences: true,
});
