#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PhpWasmEdgeBoardStack } from '../lib/php-wasm-edge-board-stack';

const app = new cdk.App();

new PhpWasmEdgeBoardStack(app, 'PhpWasmEdgeBoardStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1', // Lambda@Edge must be in us-east-1
  },
  crossRegionReferences: true,
});
