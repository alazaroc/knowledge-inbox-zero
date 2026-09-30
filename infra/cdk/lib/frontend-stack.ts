import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { ResourceNaming } from './naming';

interface FrontendStackProps extends cdk.StackProps {
  naming: ResourceNaming;
  // Optional custom domain. The ACM certificate must live in us-east-1 (CloudFront).
  domainName?: string;
  certificateArn?: string;
}

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { naming, domainName, certificateArn } = props;

    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: naming.global('frontend'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const certificate = certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn)
      : undefined;

    // CloudFront Function: adds security headers to responses.
    const securityHeadersFn = new cloudfront.Function(this, 'SecurityHeadersFn', {
      functionName: naming.standard('security-headers'),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, 'cf-security-headers.js'),
      }),
    });

    const associationDefault: cloudfront.FunctionAssociation = {
      function: securityHeadersFn,
      eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: naming.standard('cdn'),
      ...(domainName && certificate ? { domainNames: [domainName], certificate } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [associationDefault],
      },
      additionalBehaviors: {
        // index.html is not cached aggressively so updates reach users.
        '/index.html': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          functionAssociations: [associationDefault],
        },
      },
      defaultRootObject: 'index.html',
      // SPA fallback: any unknown route serves index.html.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    const cloudfrontUrl = domainName
      ? `https://${domainName}`
      : `https://${distribution.distributionDomainName}`;

    new ssm.StringParameter(this, 'CloudFrontUrlParam', {
      parameterName: naming.ssm('cloudfront-url'),
      stringValue: cloudfrontUrl,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: bucket.bucketName,
      exportName: naming.standard('frontend-bucket'),
    });
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: cloudfrontUrl,
      exportName: naming.standard('cloudfront-url'),
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      exportName: naming.standard('distribution-id'),
    });
  }
}
