import * as path from 'node:path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_appsync as appsync,
  aws_cloudwatch as cloudwatch,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_iot as iot,
  aws_kinesisfirehose as firehose,
  aws_lambda as lambda,
  aws_lambda_event_sources as lambdaEventSources,
  aws_logs as logs,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class GeoStreamCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const currentLocationsTable = new dynamodb.Table(this, 'CurrentLocationsTable', {
      tableName: `${this.stackName}-current-locations`,
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const recentLocationsTable = new dynamodb.Table(this, 'RecentLocationsTable', {
      tableName: `${this.stackName}-recent-locations`,
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'capturedAt', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const historyBucket = new s3.Bucket(this, 'HistoryBucket', {
      bucketName: `${this.account}-${this.region}-${this.stackName.toLowerCase()}-history`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    historyBucket.grantReadWrite(firehoseRole);
    firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:PutLogEvents'],
        resources: ['*'],
      }),
    );

    const firehoseLogGroup = new logs.LogGroup(this, 'FirehoseLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const firehoseLogStream = new logs.LogStream(this, 'FirehoseLogStream', {
      logGroup: firehoseLogGroup,
    });

    const deliveryStream = new firehose.CfnDeliveryStream(this, 'GeoDeliveryStream', {
      deliveryStreamName: `${this.stackName}-geo-history-stream`,
      deliveryStreamType: 'DirectPut',
      extendedS3DestinationConfiguration: {
        bucketArn: historyBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 5,
        },
        compressionFormat: 'UNCOMPRESSED',
        prefix: 'year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/',
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: firehoseLogGroup.logGroupName,
          logStreamName: firehoseLogStream.logStreamName,
        },
      },
    });

    const iotRuleRole = new iam.Role(this, 'IotRuleRole', {
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
    });
    iotRuleRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
        resources: [deliveryStream.attrArn],
      }),
    );

    const ingestFn = new lambda.Function(this, 'IngestLocationFn', {
      functionName: `${this.stackName}-ingest-location`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'ingest')),
      timeout: Duration.seconds(10),
      environment: {
        CURRENT_TABLE_NAME: currentLocationsTable.tableName,
        RECENT_TABLE_NAME: recentLocationsTable.tableName,
        RECENT_TTL_DAYS: '30',
      },
    });

    currentLocationsTable.grantReadWriteData(ingestFn);
    recentLocationsTable.grantReadWriteData(ingestFn);

    const userPool = new cognito.UserPool(this, 'GeoUserPool', {
      userPoolName: `${this.stackName}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'GeoUserPoolClient', {
      userPool,
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
      oAuth: {
        flows: {
          implicitCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: ['http://localhost:8080/', 'http://127.0.0.1:8080/'],
        logoutUrls: ['http://localhost:8080/', 'http://127.0.0.1:8080/'],
      },
    });

    const userPoolDomain = new cognito.UserPoolDomain(this, 'GeoUserPoolDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix: `${this.stackName.toLowerCase()}-${this.account}`,
      },
    });

    const graphqlApi = new appsync.GraphqlApi(this, 'GeoGraphqlApi', {
      name: `${this.stackName}-geo-api`,
      definition: appsync.Definition.fromFile(path.join(__dirname, '..', 'graphql', 'schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
        additionalAuthorizationModes: [{ authorizationType: appsync.AuthorizationType.IAM }],
      },
      xrayEnabled: true,
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
      },
    });

    const apiHandlerFn = new lambda.Function(this, 'ApiHandlerFn', {
      functionName: `${this.stackName}-api-handler`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'api-handler')),
      timeout: Duration.seconds(10),
      environment: {
        CURRENT_TABLE_NAME: currentLocationsTable.tableName,
        RECENT_TABLE_NAME: recentLocationsTable.tableName,
      },
    });

    currentLocationsTable.grantReadData(apiHandlerFn);
    recentLocationsTable.grantReadData(apiHandlerFn);

    const lambdaDataSource = graphqlApi.addLambdaDataSource('GeoLambdaDataSource', apiHandlerFn);

    lambdaDataSource.createResolver('GetCurrentLocationResolver', {
      typeName: 'Query',
      fieldName: 'getCurrentLocation',
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    lambdaDataSource.createResolver('ListCurrentLocationsResolver', {
      typeName: 'Query',
      fieldName: 'listCurrentLocations',
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    lambdaDataSource.createResolver('ListRecentLocationsResolver', {
      typeName: 'Query',
      fieldName: 'listRecentLocations',
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    lambdaDataSource.createResolver('PublishLocationUpdateResolver', {
      typeName: 'Mutation',
      fieldName: 'publishLocationUpdate',
      requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
      responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    });

    const noneDataSource = graphqlApi.addNoneDataSource('NoneDataSource');
    noneDataSource.createResolver('OnLocationUpdateResolver', {
      typeName: 'Subscription',
      fieldName: 'onLocationUpdate',
      requestMappingTemplate: appsync.MappingTemplate.fromString('{"version":"2018-05-29","payload":{}}'),
      responseMappingTemplate: appsync.MappingTemplate.fromString('$util.toJson(null)'),
    });

    const streamPublisherFn = new lambda.Function(this, 'StreamPublisherFn', {
      functionName: `${this.stackName}-stream-publisher`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'stream-publisher')),
      timeout: Duration.seconds(20),
      environment: {
        APPSYNC_API_URL: graphqlApi.graphqlUrl,
      },
    });

    streamPublisherFn.addEventSource(
      new lambdaEventSources.DynamoEventSource(currentLocationsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 2,
      }),
    );

    streamPublisherFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${graphqlApi.arn}/types/Mutation/fields/publishLocationUpdate`],
      }),
    );

    const iotRule = new iot.CfnTopicRule(this, 'GeoIotRule', {
      ruleName: `${this.stackName}_geo_ingest_rule`,
      topicRulePayload: {
        sql: "SELECT * FROM 'geo/+'",
        actions: [
          {
            lambda: {
              functionArn: ingestFn.functionArn,
            },
          },
          {
            firehose: {
              deliveryStreamName: deliveryStream.deliveryStreamName ?? `${this.stackName}-geo-history-stream`,
              roleArn: iotRuleRole.roleArn,
              separator: '\n',
            },
          },
        ],
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
      },
    });

    ingestFn.addPermission('AllowIotInvokeIngestFn', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      sourceArn: `arn:aws:iot:${this.region}:${this.account}:rule/${iotRule.ruleName}`,
    });

    const ingestErrorAlarm = new cloudwatch.Alarm(this, 'IngestLambdaErrorAlarm', {
      metric: ingestFn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Ingest lambda returned errors.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const streamPublisherErrorAlarm = new cloudwatch.Alarm(this, 'StreamPublisherLambdaErrorAlarm', {
      metric: streamPublisherFn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Stream publisher lambda returned errors.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const dynamoThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoThrottleAlarm', {
      metric: currentLocationsTable.metricThrottledRequestsForOperation('PutItem', {
        period: Duration.minutes(5),
        statistic: 'sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Current location DynamoDB table had throttled requests.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const firehoseSuccessAlarm = new cloudwatch.Alarm(this, 'FirehoseDeliveryFailureAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Firehose',
        metricName: 'DeliveryToS3.Success',
        dimensionsMap: { DeliveryStreamName: deliveryStream.ref },
        period: Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 99,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      alarmDescription: 'Firehose delivery success ratio dropped below 99%.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    [ingestErrorAlarm, streamPublisherErrorAlarm, dynamoThrottleAlarm, firehoseSuccessAlarm].forEach((alarm, index) => {
      new CfnOutput(this, `AlarmName${index + 1}`, { value: alarm.alarmName });
    });

    new CfnOutput(this, 'CurrentLocationsTableName', { value: currentLocationsTable.tableName });
    new CfnOutput(this, 'RecentLocationsTableName', { value: recentLocationsTable.tableName });
    new CfnOutput(this, 'HistoryBucketName', { value: historyBucket.bucketName });
    new CfnOutput(this, 'GraphqlApiUrl', { value: graphqlApi.graphqlUrl });
    new CfnOutput(this, 'GraphqlApiId', { value: graphqlApi.apiId });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'UserPoolDomainUrl', { value: userPoolDomain.baseUrl() });
    new CfnOutput(this, 'IotTopicRuleName', { value: iotRule.ruleName ?? 'unknown' });
    new CfnOutput(this, 'IotTopicPattern', { value: 'geo/{deviceId}' });
    new CfnOutput(this, 'FirehoseDeliveryStreamName', { value: deliveryStream.ref });
  }
}
