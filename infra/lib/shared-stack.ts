import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { GitHubOidcConstruct } from './constructs/iam';

export interface BallotTrackSharedStackProps extends cdk.StackProps {
  domainName: string;
  githubRepo: string;
  awsAccountId: string;
  awsRegion: string;
}

export class BallotTrackSharedStack extends cdk.Stack {
  public readonly hostedZone: route53.IPublicHostedZone;

  constructor(scope: Construct, id: string, props: BallotTrackSharedStackProps) {
    super(scope, id, props);

    // ----- Route 53 Public Hosted Zone -----
    const zone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: props.domainName,
    });
    this.hostedZone = zone;

    // ----- GitHub Actions OIDC provider + role -----
    const github = new GitHubOidcConstruct(this, 'GitHubOidc', {
      githubRepo: props.githubRepo,
      awsAccountId: props.awsAccountId,
      awsRegion: props.awsRegion,
    });

    // ----- Outputs -----
    new cdk.CfnOutput(this, 'Route53NameServers', {
      value: cdk.Fn.join(', ', zone.hostedZoneNameServers!),
      description: 'Provide these NS records to your external DNS manager for delegation',
    });

    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: github.role.roleArn,
      description: 'IAM role ARN for GitHub Actions to assume via OIDC',
    });
  }
}
