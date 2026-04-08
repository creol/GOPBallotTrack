import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface NetworkingProps {
  envName: string;
  allowedSshCidr: string;
}

export class NetworkingConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly ec2SecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkingProps) {
    super(scope, id);

    // VPC — 2 AZs, public subnets (EC2) + private isolated subnets (RDS), no NAT
    this.vpc = new ec2.Vpc(this, 'VPC', {
      vpcName: `ballottrack-${props.envName}`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // EC2 Security Group — HTTP, HTTPS from anywhere; SSH from allowed CIDR only
    this.ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SG', {
      vpc: this.vpc,
      securityGroupName: `ballottrack-${props.envName}-ec2`,
      description: `BallotTrack ${props.envName} EC2 instance`,
      allowAllOutbound: true,
    });
    this.ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP from anywhere',
    );
    this.ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS from anywhere',
    );
    this.ec2SecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.allowedSshCidr),
      ec2.Port.tcp(22),
      'SSH from allowed IP only',
    );

    // RDS Security Group — PostgreSQL from EC2 SG only, no outbound needed
    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RDSSG', {
      vpc: this.vpc,
      securityGroupName: `ballottrack-${props.envName}-rds`,
      description: `BallotTrack ${props.envName} RDS instance`,
      allowAllOutbound: false,
    });
    this.rdsSecurityGroup.addIngressRule(
      this.ec2SecurityGroup,
      ec2.Port.tcp(5432),
      'PostgreSQL from EC2 only',
    );
  }
}
