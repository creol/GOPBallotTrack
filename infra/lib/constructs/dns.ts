import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface DnsProps {
  envName: string;
  domainName: string;
  hostedZone: route53.IPublicHostedZone;
  elasticIp: ec2.CfnEIP;
  distribution: cloudfront.Distribution;
}

export class DnsConstruct extends Construct {
  constructor(scope: Construct, id: string, props: DnsProps) {
    super(scope, id);

    const isProd = props.envName === 'prod';

    // A record — prod: domainName  |  dev: dev.domainName
    const appRecordName = isProd ? props.domainName : `dev.${props.domainName}`;
    new route53.ARecord(this, 'AppARecord', {
      zone: props.hostedZone,
      recordName: appRecordName,
      target: route53.RecordTarget.fromIpAddresses(props.elasticIp.ref),
    });

    // CNAME — prod: images.domainName  |  dev: images-dev.domainName
    const imagesRecordName = isProd
      ? `images.${props.domainName}`
      : `images-dev.${props.domainName}`;
    new route53.CnameRecord(this, 'ImagesCname', {
      zone: props.hostedZone,
      recordName: imagesRecordName,
      domainName: props.distribution.distributionDomainName,
    });
  }
}
