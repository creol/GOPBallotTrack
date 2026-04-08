import {
  EC2Client,
  StartInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  RDSClient,
  StartDBInstanceCommand,
  DescribeDBInstancesCommand,
} from '@aws-sdk/client-rds';

const ec2 = new EC2Client({});
const rds = new RDSClient({});

/**
 * Starts the dev EC2 instance and RDS instance.
 * Idempotent — returns success if either resource is already running.
 */
export const handler = async (): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> => {
  const ec2InstanceId = process.env.EC2_INSTANCE_ID!;
  const rdsInstanceId = process.env.RDS_INSTANCE_ID!;

  const results: Record<string, string> = {};

  // --- Start EC2 ---
  try {
    const desc = await ec2.send(
      new DescribeInstancesCommand({ InstanceIds: [ec2InstanceId] }),
    );
    const state = desc.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown';

    if (state === 'stopped') {
      await ec2.send(new StartInstancesCommand({ InstanceIds: [ec2InstanceId] }));
      results.ec2 = 'starting';
    } else {
      results.ec2 = `already ${state}`;
    }
  } catch (err: unknown) {
    results.ec2 = `error: ${(err as Error).message}`;
  }

  // --- Start RDS ---
  try {
    const desc = await rds.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: rdsInstanceId }),
    );
    const dbState = desc.DBInstances?.[0]?.DBInstanceStatus ?? 'unknown';

    if (dbState === 'stopped') {
      await rds.send(
        new StartDBInstanceCommand({ DBInstanceIdentifier: rdsInstanceId }),
      );
      results.rds = 'starting';
    } else {
      results.rds = `already ${dbState}`;
    }
  } catch (err: unknown) {
    results.rds = `error: ${(err as Error).message}`;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Dev start requested', ...results }),
  };
};
