#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DocsBotCdkStack } from "../lib/docs-bot-cdk-stack";

const app = new cdk.App();
new DocsBotCdkStack(app, "DocsBotCdkStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
