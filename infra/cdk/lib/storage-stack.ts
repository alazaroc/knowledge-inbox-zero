import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { ResourceNaming } from './naming';

export interface Tables {
  users: dynamodb.Table;
  items: dynamodb.Table;
  shares: dynamodb.Table;
}

interface StorageStackProps extends cdk.StackProps {
  naming: ResourceNaming;
}

export class StorageStack extends cdk.Stack {
  readonly tables: Tables;

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

    const tablePkSk = (logicalId: string, domain: string, pkName: string, skName: string) =>
      new dynamodb.Table(this, logicalId, {
        tableName: naming.standard(domain),
        partitionKey: { name: pkName, type: STR },
        sortKey: { name: skName, type: STR },
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

    // Items: example root entity. GSI byOwner to list a user's items.
    const items = tablePk('Items', 'items', 'itemId');
    items.addGlobalSecondaryIndex({
      indexName: 'byOwner',
      partitionKey: { name: 'ownerId', type: STR },
      sortKey: { name: 'itemId', type: STR },
    });

    // Shares: access of an item to another user (PK itemId, SK userId). GSI byUser.
    const shares = tablePkSk('Shares', 'shares', 'itemId', 'userId');
    shares.addGlobalSecondaryIndex({
      indexName: 'byUser',
      partitionKey: { name: 'userId', type: STR },
      sortKey: { name: 'itemId', type: STR },
    });

    this.tables = { users, items, shares };
  }
}
