import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ComputeProps {
  envName: string;
  vpc: ec2.Vpc;
  ec2SecurityGroup: ec2.SecurityGroup;
}

export class ComputeConstruct extends Construct {
  public readonly instance: ec2.Instance;
  public readonly elasticIp: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: ComputeProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const isProd = props.envName === 'prod';

    // ----- IAM role for EC2 (instance profile) -----
    const role = new iam.Role(this, 'InstanceRole', {
      roleName: `ballottrack-${props.envName}-ec2`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        // SSM Agent — needed for GitHub Actions SSM SendCommand
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // S3 — read/write ballot images bucket
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3BallotImages',
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
        resources: [
          `arn:aws:s3:::ballottrack-${props.envName}-*`,
          `arn:aws:s3:::ballottrack-${props.envName}-*/*`,
        ],
      }),
    );

    // ECR — pull images
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRAuth',
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'], // ecr:GetAuthorizationToken does not support resource-level permissions
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRPull',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
        resources: [
          `arn:aws:ecr:${stack.region}:${stack.account}:repository/ballottrack-${props.envName}`,
        ],
      }),
    );

    // Secrets Manager — read app secrets + RDS password
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManagerRead',
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:ballottrack/${props.envName}/*`,
        ],
      }),
    );

    // SSM Parameter Store — read runtime config
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SSMParameterRead',
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: [
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter/ballottrack/${props.envName}/*`,
        ],
      }),
    );

    // ----- SSH key pair (private key stored in SSM automatically) -----
    const keyPair = new ec2.KeyPair(this, 'KeyPair', {
      keyPairName: `ballottrack-${props.envName}`,
    });

    // ----- UserData — install Docker + Docker Compose on first boot -----
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euo pipefail',
      '',
      '# Install Docker on Amazon Linux 2023',
      'dnf update -y',
      'dnf install -y docker',
      'systemctl start docker',
      'systemctl enable docker',
      'usermod -a -G docker ec2-user',
      '',
      '# Install Docker Compose v2 plugin',
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \\',
      '  -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
      'ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose',
      '',
      '# Create app directory',
      'mkdir -p /opt/ballottrack',
      'chown ec2-user:ec2-user /opt/ballottrack',
    );

    // ----- EC2 Instance -----
    this.instance = new ec2.Instance(this, 'Instance', {
      instanceName: `ballottrack-${props.envName}`,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(isProd ? 't3.large' : 't3.micro'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: props.ec2SecurityGroup,
      role,
      keyPair,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(isProd ? 50 : 20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    });

    // ----- Elastic IP — stable public address across stop/start -----
    this.elasticIp = new ec2.CfnEIP(this, 'EIP', {
      tags: [{ key: 'Name', value: `ballottrack-${props.envName}` }],
    });
    if (isProd) {
      this.elasticIp.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    }

    new ec2.CfnEIPAssociation(this, 'EIPAssoc', {
      allocationId: this.elasticIp.attrAllocationId,
      instanceId: this.instance.instanceId,
    });

    // ----- Output: how to retrieve SSH private key -----
    new cdk.CfnOutput(stack, `${props.envName}SshKeyParam`, {
      value: `/ec2/keypair/${keyPair.keyPairId}`,
      description: `SSM parameter path for ${props.envName} SSH private key. Retrieve with: aws ssm get-parameter --name <value> --with-decryption`,
    });
  }
}
