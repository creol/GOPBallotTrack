import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NetworkingConstruct } from './constructs/networking';
import { ComputeConstruct } from './constructs/compute';
import { DatabaseConstruct } from './constructs/database';
import { StorageConstruct } from './constructs/storage';
import { CdnConstruct } from './constructs/cdn';
import { DnsConstruct } from './constructs/dns';
import { EcrConstruct } from './constructs/ecr';
import { DevStartConstruct } from './constructs/devstart';

export interface BallotTrackStackProps extends cdk.StackProps {
  envName: 'dev' | 'prod';
  domainName: string;
  allowedSshCidr: string;
  devStartApiKey: string;
  hostedZone: route53.IPublicHostedZone;
  awsAccountId: string;
  awsRegion: string;
}

export class BallotTrackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BallotTrackStackProps) {
    super(scope, id, props);

    const { envName } = props;

    // 1. Networking — VPC, subnets, security groups
    const networking = new NetworkingConstruct(this, 'Networking', {
      envName,
      allowedSshCidr: props.allowedSshCidr,
    });

    // 2. Compute — EC2 instance + Elastic IP
    const compute = new ComputeConstruct(this, 'Compute', {
      envName,
      vpc: networking.vpc,
      ec2SecurityGroup: networking.ec2SecurityGroup,
    });

    // 3. Database — RDS PostgreSQL
    const database = new DatabaseConstruct(this, 'Database', {
      envName,
      vpc: networking.vpc,
      rdsSecurityGroup: networking.rdsSecurityGroup,
    });

    // 4. Storage — S3 bucket for ballot images
    const storage = new StorageConstruct(this, 'Storage', {
      envName,
    });

    // 5. CDN — CloudFront distribution
    const cdn = new CdnConstruct(this, 'CDN', {
      envName,
      bucket: storage.bucket,
    });

    // 6. DNS records in the shared hosted zone
    new DnsConstruct(this, 'DNS', {
      envName,
      domainName: props.domainName,
      hostedZone: props.hostedZone,
      elasticIp: compute.elasticIp,
      distribution: cdn.distribution,
    });

    // 7. ECR repository
    const ecr = new EcrConstruct(this, 'ECR', {
      envName,
    });

    // 8. Secrets & config — SSM Parameter Store + Secrets Manager
    this.createSecretsAndConfig(envName, cdn, storage, database);

    // 9. Dev Start Lambda + API Gateway (dev only)
    if (envName === 'dev') {
      new DevStartConstruct(this, 'DevStart', {
        ec2Instance: compute.instance,
        dbInstance: database.dbInstance,
        devStartApiKey: props.devStartApiKey,
      });
    }

    // ----- Outputs -----
    new cdk.CfnOutput(this, `${envName}ElasticIp`, {
      value: compute.elasticIp.attrPublicIp,
      description: `${envName} EC2 Elastic IP address`,
    });

    new cdk.CfnOutput(this, `${envName}RdsEndpoint`, {
      value: database.dbInstance.dbInstanceEndpointAddress,
      description: `${envName} RDS endpoint`,
    });

    new cdk.CfnOutput(this, `${envName}S3BucketName`, {
      value: storage.bucket.bucketName,
      description: `${envName} S3 bucket name`,
    });

    new cdk.CfnOutput(this, `${envName}CloudFrontDomain`, {
      value: cdn.distribution.distributionDomainName,
      description: `${envName} CloudFront distribution domain`,
    });

    new cdk.CfnOutput(this, `${envName}EcrRepositoryUri`, {
      value: ecr.repository.repositoryUri,
      description: `${envName} ECR repository URI`,
    });
  }

  /**
   * Creates an empty Secrets Manager placeholder for app secrets and
   * SSM Parameter Store entries for non-secret runtime config.
   */
  private createSecretsAndConfig(
    envName: string,
    cdn: CdnConstruct,
    storage: StorageConstruct,
    database: DatabaseConstruct,
  ): void {
    // Empty secret — developer populates after deploy (JWT secret, etc.)
    new secretsmanager.Secret(this, 'AppSecrets', {
      secretName: `ballottrack/${envName}/app-secrets`,
      description:
        'Application secrets (JWT secret, etc.). Populate manually after deploy.',
    });

    // Non-secret config readable at runtime without hardcoding
    new ssm.StringParameter(this, 'ParamCloudFrontDomain', {
      parameterName: `/ballottrack/${envName}/cloudfront-domain`,
      stringValue: cdn.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new ssm.StringParameter(this, 'ParamS3BucketName', {
      parameterName: `/ballottrack/${envName}/s3-bucket-name`,
      stringValue: storage.bucket.bucketName,
      description: 'S3 bucket name for ballot images',
    });

    new ssm.StringParameter(this, 'ParamRdsEndpoint', {
      parameterName: `/ballottrack/${envName}/rds-endpoint`,
      stringValue: database.dbInstance.dbInstanceEndpointAddress,
      description: 'RDS PostgreSQL endpoint address',
    });
  }
}
