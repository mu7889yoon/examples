#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ExistingTodoResources, TodoStack } from '../lib/todo-stack';

function existingResourcesFromEnvironment(): ExistingTodoResources | undefined {
  if (process.env.TODO_REUSE_EXISTING_AWS !== 'true') {
    return undefined;
  }

  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is required when TODO_REUSE_EXISTING_AWS=true`);
    }
    return value;
  };

  const publicSubnets = JSON.parse(required('TODO_EXISTING_PUBLIC_SUBNETS')) as ExistingTodoResources['publicSubnets'];

  return {
    vpcId: required('TODO_EXISTING_VPC_ID'),
    publicSubnets,
    databaseClusterId: required('TODO_EXISTING_DATABASE_CLUSTER_ID'),
    databaseEndpoint: required('TODO_EXISTING_DATABASE_ENDPOINT'),
    databasePort: Number(process.env.TODO_EXISTING_DATABASE_PORT ?? '5432'),
    databaseSecurityGroupId: required('TODO_EXISTING_DATABASE_SECURITY_GROUP_ID'),
    databaseSecretArn: required('TODO_EXISTING_DATABASE_SECRET_ARN')
  };
}

const app = new cdk.App();

const stackId = process.env.TODO_STACK_ID ?? 'TodoStack';

new TodoStack(app, stackId, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1'
  },
  existingResources: existingResourcesFromEnvironment()
});
