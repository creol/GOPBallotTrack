import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export interface EcrProps {
  envName: string;
}

export class EcrConstruct extends Construct {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrProps) {
    super(scope, id);

    const isProd = props.envName === 'prod';

    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: `ballottrack-${props.envName}`,
      imageScanOnPush: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: !isProd, // Dev: allow CloudFormation to delete non-empty repo
      lifecycleRules: [
        {
          description: 'Keep only the last 10 images to control costs',
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
    });
  }
}
