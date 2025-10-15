import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';

export class StepFunctionsContactFormStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // SNSトピック（バリデーション成功時の通知）
    const notifyTopic = new sns.Topic(this, 'ContactFormNotifyTopic', {
      displayName: 'Contact Form Notifications'
    });

    // ステップ1: JSONataでバリデーションを実行
    const validationState = new sfn.CustomState(this, 'ValidateInput', {
      stateJson: {
        Type: 'Pass',
        Comment: 'Validate form input using JSONata',
        QueryLanguage: 'JSONata',
        Output: {
          input: '{% $states.input %}',
          nameError: '{% $states.input.name = null or $trim($string($states.input.name)) = "" ? {"field":"name","message":"必須"} : null %}',
          furiganaError: '{% $states.input.furigana = null or $trim($string($states.input.furigana)) = "" ? {"field":"furigana","message":"必須"} : $match($string($states.input.furigana), /^[ァ-ヶー]+$/) = null ? {"field":"furigana","message":"全角カタカナ"} : null %}',
          emailError: '{% $states.input.email = null or $trim($string($states.input.email)) = "" ? {"field":"email","message":"必須"} : $match($string($states.input.email), /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/) = null ? {"field":"email","message":"形式不正"} : null %}',
          petError: '{% $states.input.pet = null or ($states.input.pet in ["dog","cat","bird"]) = false ? {"field":"pet","message":"必須"} : null %}',
          agreeError: '{% $states.input.agree != true ? {"field":"agree","message":"同意必須"} : null %}',
          postalError: '{% $states.input.postal != null and $match($string($states.input.postal), /^\\d{7}$/) = null ? {"field":"postal","message":"7桁数字"} : null %}',
          questionError: '{% $states.input.question != null and $length($string($states.input.question)) > 500 ? {"field":"question","message":"500文字以内"} : null %}'
        }
      }
    });

    // ステップ2: エラー配列を構築
    const buildErrorArray = new sfn.CustomState(this, 'BuildErrorArray', {
      stateJson: {
        Type: 'Pass',
        QueryLanguage: 'JSONata',
        Output: {
          input: '{% $states.input.input %}',
          errors: '{% ($errorList := [$states.input.nameError, $states.input.furiganaError, $states.input.emailError, $states.input.petError, $states.input.agreeError, $states.input.postalError, $states.input.questionError][$ != null]; $exists($errorList) ? $errorList : []) %}',
          isValid: '{% $count([$states.input.nameError, $states.input.furiganaError, $states.input.emailError, $states.input.petError, $states.input.agreeError, $states.input.postalError, $states.input.questionError][$ != null]) = 0 %}'
        }
      }
    });

    // ステップ3: SNS通知タスク（バリデーション成功時）
    const notifyTask = new tasks.SnsPublish(this, 'NotifyValidSubmission', {
      topic: notifyTopic,
      message: sfn.TaskInput.fromObject({
        'default': 'New contact form submission received',
        'formData.$': '$.input'
      }),
      subject: 'Contact Form Submission',
      resultPath: sfn.JsonPath.DISCARD
    });

    // ステップ4: 成功レスポンスの生成
    const successResponse = new sfn.Pass(this, 'SuccessResponse', {
      parameters: {
        isValid: true,
        message: 'お問い合わせを受け付けました'
      }
    });

    // ステップ5: 失敗レスポンスの生成
    const failureResponse = new sfn.Pass(this, 'FailureResponse', {
      parameters: {
        'isValid.$': '$.isValid',
        'errors.$': '$.errors'
      }
    });

    // Choice: バリデーション結果で分岐
    const checkValidation = new sfn.Choice(this, 'CheckValidation')
      .when(
        sfn.Condition.booleanEquals('$.isValid', true),
        notifyTask.next(successResponse)
      )
      .otherwise(failureResponse);

    // ステートマシンの定義
    const definition = sfn.Chain
      .start(validationState)
      .next(buildErrorArray)
      .next(checkValidation);

    const stateMachine = new sfn.StateMachine(this, 'ContactFormStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.EXPRESS,
      timeout: cdk.Duration.seconds(30)
    });

    // API Gateway REST API
    const api = new apigateway.RestApi(this, 'ContactFormApi', {
      restApiName: 'Contact Form Service',
      description: 'Serverless contact form with Step Functions validation',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key']
      }
    });

    // API Gatewayに必要なIAMロール
    const apiGatewayRole = new iam.Role(this, 'ApiGatewayStepFunctionsRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      description: 'Role for API Gateway to invoke Step Functions'
    });

    apiGatewayRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['states:StartSyncExecution'],
        resources: [stateMachine.stateMachineArn]
      })
    );

    // /contact リソースの追加
    const contactResource = api.root.addResource('contact');

    // Step Functions統合
    const stepFunctionsIntegration = new apigateway.AwsIntegration({
      service: 'states',
      action: 'StartSyncExecution',
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: apiGatewayRole,
        requestTemplates: {
          'application/json': `{
  "stateMachineArn": "${stateMachine.stateMachineArn}",
  "input": "\$util.escapeJavaScript(\$input.json('\$'))"
}`
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': `\$input.path('\$.output')`
            },
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'"
            }
          },
          {
            statusCode: '500',
            selectionPattern: '5\\d{2}',
            responseTemplates: {
              'application/json': '{"error": "Internal server error"}'
            }
          }
        ]
      }
    });

    // POSTメソッドの追加
    contactResource.addMethod('POST', stepFunctionsIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true
          }
        },
        {
          statusCode: '500'
        }
      ]
    });

    // 出力
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL. Use POST {ApiEndpoint}contact',
      exportName: 'ContactFormApiEndpoint'
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Step Functions state machine ARN'
    });

    new cdk.CfnOutput(this, 'SnsTopicArn', {
      value: notifyTopic.topicArn,
      description: 'SNS topic ARN for notifications'
    });
  }
}
