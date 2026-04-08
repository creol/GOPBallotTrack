import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';

export interface SchedulerProps {
  ec2Instance: ec2.Instance;
}

/**
 * EventBridge Scheduler rules to auto-stop the dev EC2 instance:
 *   - Weeknights (Mon–Fri) at 8 PM Mountain Time
 *   - Weekend mornings (Sat–Sun) at 6 AM Mountain Time (safety catch)
 *
 * No auto-start is created — dev is started on demand via the DevStart Lambda.
 */
export class SchedulerConstruct extends Construct {
  constructor(scope: Construct, id: string, props: SchedulerProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // IAM role for EventBridge Scheduler to call ec2:StopInstances
    const schedulerRole = new iam.Role(this, 'Role', {
      roleName: 'ballottrack-dev-scheduler',
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StopInstances'],
        resources: [
          `arn:aws:ec2:${stack.region}:${stack.account}:instance/${props.ec2Instance.instanceId}`,
        ],
      }),
    );

    const targetInput = `{"InstanceIds":["${props.ec2Instance.instanceId}"]}`;

    // Stop weeknights at 8 PM Mountain Time
    new scheduler.CfnSchedule(this, 'WeekdayStop', {
      name: 'ballottrack-dev-weekday-stop',
      description: 'Stop dev EC2 Mon–Fri at 8 PM Denver time',
      scheduleExpression: 'cron(0 20 ? * MON-FRI *)',
      scheduleExpressionTimezone: 'America/Denver',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
        roleArn: schedulerRole.roleArn,
        input: targetInput,
      },
    });

    // Stop weekend mornings at 6 AM Mountain Time (catch manual starts)
    new scheduler.CfnSchedule(this, 'WeekendStop', {
      name: 'ballottrack-dev-weekend-stop',
      description: 'Stop dev EC2 Sat–Sun at 6 AM Denver time',
      scheduleExpression: 'cron(0 6 ? * SAT,SUN *)',
      scheduleExpressionTimezone: 'America/Denver',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
        roleArn: schedulerRole.roleArn,
        input: targetInput,
      },
    });
  }
}
