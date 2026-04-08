import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CdnProps {
  envName: string;
  bucket: s3.Bucket;
}

export class CdnConstruct extends Construct {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CdnProps) {
    super(scope, id);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `BallotTrack ${props.envName} ballot images`,
      defaultBehavior: {
        // Origin Access Control — CDK automatically creates the OAC and
        // adds the required bucket policy granting CloudFront read access.
        origin: origins.S3BucketOrigin.withOriginAccessControl(props.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: new cloudfront.CachePolicy(this, 'CachePolicy', {
          cachePolicyName: `ballottrack-${props.envName}-default`,
          defaultTtl: cdk.Duration.hours(1),
          maxTtl: cdk.Duration.days(7),
          minTtl: cdk.Duration.seconds(0),
        }),
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // North America + Europe
    });
  }
}
