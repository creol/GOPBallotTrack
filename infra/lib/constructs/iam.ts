import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubOidcProps {
  githubRepo: string; // format: "owner/repo"
  awsAccountId: string;
  awsRegion: string;
}

/**
 * GitHub Actions OIDC provider + IAM role.
 * Lives in the shared stack so both dev and prod can use the same role.
 *
 * If your AWS account already has a GitHub OIDC provider (from another project),
 * replace the OpenIdConnectProvider below with:
 *   iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'GitHubProvider',
 *     `arn:aws:iam::${props.awsAccountId}:oidc-provider/token.actions.githubusercontent.com`);
 */
export class GitHubOidcConstruct extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubOidcProps) {
    super(scope, id);

    const { awsAccountId, awsRegion, githubRepo } = props;

    // ----- OIDC Provider -----
    const provider = new iam.OpenIdConnectProvider(this, 'GitHubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      // AWS no longer validates GitHub's TLS thumbprint; placeholder is fine
      thumbprints: ['ffffffffffffffffffffffffffffffffffffffff'],
    });

    // ----- IAM Role for GitHub Actions -----
    this.role = new iam.Role(this, 'GitHubActionsRole', {
      roleName: 'ballottrack-github-actions',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${githubRepo}:*`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    // --- ECR push (both dev + prod repositories) ---
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRAuth',
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'], // ecr:GetAuthorizationToken does not support resource-level permissions
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRPushDevProd',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        resources: [
          `arn:aws:ecr:${awsRegion}:${awsAccountId}:repository/ballottrack-dev`,
          `arn:aws:ecr:${awsRegion}:${awsAccountId}:repository/ballottrack-prod`,
        ],
      }),
    );

    // --- SSM SendCommand — trigger Docker pull + restart on EC2 ---
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SSMDocumentAccess',
        actions: ['ssm:SendCommand'],
        resources: [
          // AWS-managed document — no account ID in the ARN
          `arn:aws:ssm:${awsRegion}::document/AWS-RunShellScript`,
        ],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SSMOnBallotTrackInstances',
        actions: ['ssm:SendCommand'],
        resources: [`arn:aws:ec2:${awsRegion}:${awsAccountId}:instance/*`],
        conditions: {
          StringEquals: { 'aws:ResourceTag/Project': 'BallotTrack' },
        },
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SSMGetCommandResult',
        actions: ['ssm:GetCommandInvocation'],
        resources: ['*'], // GetCommandInvocation does not support resource-level permissions
      }),
    );

    // --- Start dev EC2 instance before deploying ---
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EC2StartDev',
        actions: ['ec2:StartInstances'],
        resources: [`arn:aws:ec2:${awsRegion}:${awsAccountId}:instance/*`],
        conditions: {
          StringEquals: {
            'aws:ResourceTag/Project': 'BallotTrack',
            'aws:ResourceTag/Environment': 'dev',
          },
        },
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EC2DescribeAll',
        actions: ['ec2:DescribeInstances', 'ec2:DescribeInstanceStatus'],
        resources: ['*'], // Describe* actions require resource: *
      }),
    );

    // --- Start dev RDS instance before deploying ---
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RDSStartDev',
        actions: ['rds:StartDBInstance', 'rds:DescribeDBInstances'],
        resources: [
          `arn:aws:rds:${awsRegion}:${awsAccountId}:db:ballottrack-dev`,
        ],
      }),
    );
  }
}
