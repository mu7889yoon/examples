#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { GeoStreamCdkStack } from '../lib/geo-stream-cdk-stack';

const app = new App();

new GeoStreamCdkStack(app, 'GeoStreamCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
});
