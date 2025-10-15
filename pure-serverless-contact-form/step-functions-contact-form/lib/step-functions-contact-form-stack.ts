import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as sfn from 'aws-cdk-lib/aws-stepfunctions'
import * as iam from 'aws-cdk-lib/aws-iam'

export class StepFunctionsContactFormStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const contactFormStateMachine = new sfn.StateMachine(this, 'ContactFormStateMachine', {
      stateMachineType: sfn.StateMachineType.EXPRESS,
      timeout: cdk.Duration.seconds(29),
      definitionBody: sfn.DefinitionBody.fromChainable(
        (() => {
          const validateInput = sfn.Pass.jsonata(this, 'ValidateInput', {            
            outputs: {
              input: '{% $states.input %}',
              nameError: '{% $states.input.name = null or $trim($string($states.input.name)) = "" ? {"field":"name","message":"氏名は必須です。"} : null %}',
              furiganaError: '{% $states.input.furigana = null or $trim($string($states.input.furigana)) = "" ? {"field":"furigana","message":"フリガナは必須です。"} : $exists($match($string($states.input.furigana), /^[ァ-ヶー]+$/)) = false ? {"field":"furigana","message":"フリガナは全角カタカナで入力してください。"} : null %}',
              postalError: '{% $states.input.postal != null and $trim($string($states.input.postal)) != "" and $exists($match($string($states.input.postal), /^\\d{3}-?\\d{4}$/)) = false ? {"field":"postal","message":"郵便番号は7桁または3桁-4桁で入力してください。"} : null %}',
              emailError: '{% $states.input.email = null or $trim($string($states.input.email)) = "" ? {"field":"email","message":"メールアドレスは必須です。"} : $exists($match($string($states.input.email), /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/)) = false ? {"field":"email","message":"有効なメールアドレスを入力してください。"} : null %}',
              petError: '{% $states.input.pet = null or ($states.input.pet in ["dog","cat","bird"]) = false ? {"field":"pet","message":"好きなペットを選択してください。"} : null %}',
              questionError: '{% $states.input.question != null and $length($string($states.input.question)) > 500 ? {"field":"question","message":"質問は500文字以内で入力してください。"} : null %}',
              agreeError: '{% $states.input.agree != true ? {"field":"agree","message":"同意が必須です。"} : null %}',
            }
          })

          const buildErrorMessages = sfn.Pass.jsonata(this, 'BuildErrorMessages', {            
            outputs: {
              input: '{% $states.input.input %}',
              errors: '{% ($filtered := [$states.input.nameError, $states.input.furiganaError, $states.input.emailError, $states.input.petError, $states.input.agreeError, $states.input.postalError, $states.input.questionError][$ != null]; $count($filtered) = 0 ? [] : $count($filtered) = 1 ? [$filtered] : $filtered) %}',
              isValid: '{% $count([$states.input.nameError, $states.input.furiganaError, $states.input.emailError, $states.input.petError, $states.input.agreeError, $states.input.postalError, $states.input.questionError][$ != null]) = 0 %}'
            }
          })

          const successResponse = sfn.Pass.jsonPath(this, 'SuccessResponse', {
            parameters: {
              isValid: true,
              message: 'お問い合わせを受け付けました'
            }
          })

          const failureResponse = sfn.Pass.jsonPath(this, 'FailureResponse', {
            parameters: {
              'isValid.$': '$.isValid',
              'errors.$': '$.errors'
            }
          })

          const checkValidation = new sfn.Choice(this, 'CheckValidation')
            .when(
              sfn.Condition.booleanEquals('$.isValid', true),
              successResponse
            ).otherwise(
              failureResponse
            )

          return sfn.Chain.start(validateInput)
            .next(buildErrorMessages)
            .next(checkValidation)
        })()
      )
    })

    // API Gateway REST API
    const api = new apigateway.RestApi(this, 'ContactFormApi', {      
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
      }
    })
    
    const apiGatewayRole = new iam.Role(this, 'ApiGatewayStepFunctionsRole', {      
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),            
    })

    apiGatewayRole.addToPolicy(
      new iam.PolicyStatement({        
        actions: ['states:StartSyncExecution'],
        resources: [contactFormStateMachine.stateMachineArn]
      })
    )

    api.root.addResource('contact').addMethod('POST', apigateway.StepFunctionsIntegration.startExecution(contactFormStateMachine, {
      credentialsRole: apiGatewayRole,            
      requestTemplates: {
        'application/json': `{
  "stateMachineArn": "${contactFormStateMachine.stateMachineArn}",
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
      ],
      useDefaultMethodResponses: false,            
    }), {
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
    })
    
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,      
    })    
  }
}
