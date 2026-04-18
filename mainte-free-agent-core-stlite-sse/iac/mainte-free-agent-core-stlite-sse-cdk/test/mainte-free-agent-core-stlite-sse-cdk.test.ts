import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { MainteFreeAgentCoreStliteSseCdkStack } from '../lib/mainte-free-agent-core-stlite-sse-cdk-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new MainteFreeAgentCoreStliteSseCdkStack(app, 'TestStack');
  template = Template.fromStack(stack);
});

test('S3 Bucket created with BlockPublicAccess', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

test('Cognito User Pool created with email sign-in and self sign-up', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    AutoVerifiedAttributes: ['email'],
    UsernameAttributes: ['email'],
    Policies: {
      PasswordPolicy: {
        MinimumLength: 8,
        RequireUppercase: true,
        RequireNumbers: true,
        RequireSymbols: false,
      },
    },
  });
});

test('User Pool Domain created', () => {
  template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {});
});

test('User Pool Client created with Authorization Code Flow', () => {
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    AllowedOAuthFlows: ['code'],
    AllowedOAuthScopes: ['openid', 'email'],
    GenerateSecret: false,
  });
});

test('CloudFront Distribution created with S3 origin and Lambda@Edge', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      DefaultRootObject: 'index.html',
    },
  });
});

test('CfnOutputs are defined', () => {
  template.hasOutput('UserPoolId', {});
  template.hasOutput('UserPoolClientId', {});
  template.hasOutput('IdentityPoolId', {});
  template.hasOutput('CloudFrontDomainName', {});
  template.hasOutput('CloudFrontUrl', {});
  template.hasOutput('S3BucketName', {});
  template.hasOutput('HostedUiDomain', {});
  template.hasOutput('Region', {});
});
