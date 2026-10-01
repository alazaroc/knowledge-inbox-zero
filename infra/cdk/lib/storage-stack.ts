import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { ResourceNaming } from './naming';

export interface Tables {
  users: dynamodb.Table;
  profiles: dynamodb.Table;
  batches: dynamodb.Table;
  documents: dynamodb.Table;
}

interface StorageStackProps extends cdk.StackProps {
  naming: ResourceNaming;
}

export class StorageStack extends cdk.Stack {
  readonly tables: Tables;
  readonly contentBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const { naming } = props;

    const billingMode = dynamodb.BillingMode.PAY_PER_REQUEST;
    // DEFAULT encryption (AWS-owned key) → free. Still encrypted at rest without a KMS CMK.
    const encryption = dynamodb.TableEncryption.DEFAULT;
    const pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: true };
    const removalPolicy = cdk.RemovalPolicy.RETAIN;
    const STR = dynamodb.AttributeType.STRING;

    const tablePk = (logicalId: string, domain: string, pkName: string) =>
      new dynamodb.Table(this, logicalId, {
        tableName: naming.standard(domain),
        partitionKey: { name: pkName, type: STR },
        billingMode,
        encryption,
        pointInTimeRecoverySpecification,
        removalPolicy,
      });

    // Users (app profile; authentication lives in Cognito). GSI byEmail.
    const users = tablePk('Users', 'users', 'userId');
    users.addGlobalSecondaryIndex({
      indexName: 'byEmail',
      partitionKey: { name: 'email', type: STR },
    });

    // Profiles: one item per user (PK userId = Cognito sub). No SK, no GSI.
    const profiles = tablePk('Profiles', 'profiles', 'userId');

    // Batches: one item per import batch. GSI byOwner lists newest-first.
    const batches = tablePk('Batches', 'batches', 'batchId');
    batches.addGlobalSecondaryIndex({
      indexName: 'byOwner',
      partitionKey: { name: 'ownerId', type: STR },
      sortKey: { name: 'createdAt', type: STR },
    });

    // Documents: one item per canonical URL per owner (plus per-owner counts aggregate).
    const documents = tablePk('Documents', 'documents', 'documentId');
    // byOwner: full library page + pagination cursor.
    documents.addGlobalSecondaryIndex({
      indexName: 'byOwner',
      partitionKey: { name: 'ownerId', type: STR },
      sortKey: { name: 'documentId', type: STR },
    });
    // byOwnerState: filter by recommendation state without a table scan.
    documents.addGlobalSecondaryIndex({
      indexName: 'byOwnerState',
      partitionKey: { name: 'ownerId', type: STR },
      sortKey: { name: 'stateKey', type: STR },
    });
    // byBatch: worker and batch-progress lookups.
    documents.addGlobalSecondaryIndex({
      indexName: 'byBatch',
      partitionKey: { name: 'batchId', type: STR },
      sortKey: { name: 'documentId', type: STR },
    });

    this.tables = { users, profiles, batches, documents };

    // Private bucket for offloaded extracted content (> 300KB). Object key: {ownerId}/{documentId}.txt.
    // Block all public access, SSE-S3 (S3-managed) encryption, retained on stack deletion.
    this.contentBucket = new s3.Bucket(this, 'ContentBucket', {
      bucketName: naming.standard('content'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
