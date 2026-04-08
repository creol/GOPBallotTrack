import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface DatabaseProps {
  envName: string;
  vpc: ec2.Vpc;
  rdsSecurityGroup: ec2.SecurityGroup;
}

export class DatabaseConstruct extends Construct {
  public readonly dbInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const isProd = props.envName === 'prod';

    this.dbInstance = new rds.DatabaseInstance(this, 'PostgreSQL', {
      instanceIdentifier: `ballottrack-${props.envName}`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        isProd ? ec2.InstanceSize.MEDIUM : ec2.InstanceSize.MICRO,
      ),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.rdsSecurityGroup],
      databaseName: 'ballottrack',
      // Master password — auto-generated and stored in Secrets Manager by CDK
      credentials: rds.Credentials.fromGeneratedSecret('ballottrack', {
        secretName: `ballottrack/${props.envName}/rds-master-password`,
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: isProd ? 100 : 30,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(isProd ? 7 : 1),
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      publiclyAccessible: false,
      multiAz: false,
      // To enable automatic secret rotation, add VPC endpoints for Secrets Manager
      // in the networking construct and uncomment the line below:
      // }).addRotationSingleUser({ automaticallyAfter: cdk.Duration.days(30) });
    });
  }
}
