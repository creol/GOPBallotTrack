import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface DevStartProps {
  ec2Instance: ec2.Instance;
  dbInstance: rds.DatabaseInstance;
  devStartApiKey: string;
}

/**
 * Lambda + API Gateway endpoint to start the dev EC2 and RDS instances on demand.
 * Protected by an API key — invoke via POST with x-api-key header.
 */
export class DevStartConstruct extends Construct {
  constructor(scope: Construct, id: string, props: DevStartProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // ----- Lambda execution role (least-privilege) -----
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'ballottrack-dev-start-lambda',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });

    // EC2: start scoped to the dev instance ARN
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EC2Start',
        actions: ['ec2:StartInstances'],
        resources: [
          `arn:aws:ec2:${stack.region}:${stack.account}:instance/${props.ec2Instance.instanceId}`,
        ],
      }),
    );
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EC2Describe',
        actions: ['ec2:DescribeInstances'],
        resources: ['*'], // DescribeInstances requires resource: *
      }),
    );

    // RDS: start + describe scoped to the dev DB instance
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RDSStartDescribe',
        actions: ['rds:StartDBInstance', 'rds:DescribeDBInstances'],
        resources: [props.dbInstance.instanceArn],
      }),
    );

    // ----- Lambda function (TypeScript, bundled by esbuild) -----
    // NodejsFunction resolves entry relative to the file calling it via __filename,
    // but we use an explicit absolute path constructed from the stack's root.
    const lambdaEntry = `${process.cwd()}/lambda/dev-start/index.ts`;
    const fn = new NodejsFunction(this, 'Function', {
      functionName: 'ballottrack-dev-start',
      entry: lambdaEntry,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      role: lambdaRole,
      environment: {
        EC2_INSTANCE_ID: props.ec2Instance.instanceId,
        RDS_INSTANCE_ID: props.dbInstance.instanceIdentifier,
      },
    });

    // ----- API Gateway + API key -----
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'ballottrack-dev-start',
      description: 'Start dev EC2 + RDS instances on demand',
      deployOptions: { stageName: 'v1' },
    });

    const startResource = api.root.addResource('start');
    startResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(fn),
      { apiKeyRequired: true },
    );

    const usagePlan = api.addUsagePlan('UsagePlan', {
      name: 'ballottrack-dev-start',
      apiStages: [{ api, stage: api.deploymentStage }],
      throttle: { rateLimit: 2, burstLimit: 5 },
    });

    const apiKey = api.addApiKey('ApiKey', {
      apiKeyName: 'ballottrack-dev-start-key',
      value: props.devStartApiKey,
    });
    usagePlan.addApiKey(apiKey);

    // ----- Outputs -----
    new cdk.CfnOutput(stack, 'DevStartApiUrl', {
      value: `${api.url}start`,
      description: 'POST to this URL with x-api-key header to start dev',
    });
    new cdk.CfnOutput(stack, 'DevStartApiKeyName', {
      value: 'ballottrack-dev-start-key',
      description: 'API key name in API Gateway console',
    });
  }
}
