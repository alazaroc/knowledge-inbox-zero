import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import { ResourceNaming } from './naming';

interface ApiStackProps extends cdk.StackProps {
  naming: ResourceNaming;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { naming } = props;

    const tableNames = {
      users: naming.standard('users'),
      items: naming.standard('items'),
      shares: naming.standard('shares'),
    };

    const userPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      naming.ssm('user-pool-id')
    );
    const userPoolClientId = ssm.StringParameter.valueForStringParameter(
      this,
      naming.ssm('user-pool-client-id')
    );
    const userPoolArn = ssm.StringParameter.valueForStringParameter(
      this,
      naming.ssm('user-pool-arn')
    );

    const userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', userPoolId);
    const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
      this,
      'WebClient',
      userPoolClientId
    );

    const table = (logicalId: string, name: string) =>
      dynamodb.Table.fromTableName(this, logicalId, name);
    const tables = {
      users: table('Users', tableNames.users),
      items: table('Items', tableNames.items),
      shares: table('Shares', tableNames.shares),
    };

    const commonEnv = {
      COGNITO_USER_POOL_ID: userPoolId,
      COGNITO_CLIENT_ID: userPoolClientId,
      TABLE_USERS: tableNames.users,
      TABLE_ITEMS: tableNames.items,
      TABLE_SHARES: tableNames.shares,
    };

    // ── HTTP API (API Gateway v2): cheaper and faster than REST, with a native JWT authorizer. ──
    const authorizer = new authorizers.HttpUserPoolAuthorizer('Authorizer', userPool, {
      userPoolClients: [userPoolClient],
      identitySource: ['$request.header.Authorization'],
    });

    const httpApi = new apigwv2.HttpApi(this, 'Api', {
      apiName: naming.standard('api'),
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    (httpApi.defaultStage!.node.defaultChild as apigwv2.CfnStage).defaultRouteSettings = {
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
    };

    const fn = (name: string, handlerFile: string, extraEnv?: Record<string, string>) =>
      new NodejsFunction(this, name, {
        functionName: naming.standard(name.toLowerCase().replace(/fn$/, '')),
        entry: path.join(__dirname, '../../../backend/src/handlers', handlerFile),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        tracing: lambda.Tracing.ACTIVE,
        environment: { ...commonEnv, ...extraEnv },
        // Node 22 already ships AWS SDK v3 → don't bundle it (smaller bundle, faster cold start).
        bundling: { externalModules: ['@aws-sdk/*'], minify: true },
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
      });

    const integrationOf = new Map<lambda.IFunction, integrations.HttpLambdaIntegration>();
    const intFor = (f: lambda.IFunction) => {
      let int = integrationOf.get(f);
      if (!int) {
        int = new integrations.HttpLambdaIntegration(`Int${f.node.id}`, f, {
          payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_1_0,
        });
        integrationOf.set(f, int);
      }
      return int;
    };
    const route = (methods: apigwv2.HttpMethod[], routePath: string, f: lambda.IFunction) =>
      httpApi.addRoutes({ path: routePath, methods, integration: intFor(f) });

    const M = apigwv2.HttpMethod;

    // Allow Query on the GSIs (L2 grants only cover the base table).
    const grantQueryIndexes = (f: lambda.IFunction, tableName: string) =>
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:Query'],
          resources: [`arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}/index/*`],
        })
      );

    // ── Items ────────────────────────────────────────────────────────────────
    const itemsFn = fn('ItemsFn', 'items.ts');
    tables.items.grantReadWriteData(itemsFn);
    tables.shares.grantReadWriteData(itemsFn); // access checks + cascade delete
    grantQueryIndexes(itemsFn, tableNames.items); // GSI byOwner
    grantQueryIndexes(itemsFn, tableNames.shares); // GSI byUser
    route([M.GET, M.POST], '/items', itemsFn);
    route([M.GET, M.PUT, M.DELETE], '/items/{itemId}', itemsFn);

    // ── Shares ───────────────────────────────────────────────────────────────
    const sharesFn = fn('SharesFn', 'shares.ts');
    tables.shares.grantReadWriteData(sharesFn);
    tables.items.grantReadData(sharesFn); // owner check
    route([M.GET, M.POST], '/items/{itemId}/shares', sharesFn);
    route([M.DELETE], '/items/{itemId}/shares/{userId}', sharesFn);

    // ── Users (managed via Cognito; ADMIN only except /users/me) ──────────────
    const usersFn = fn('UsersFn', 'users.ts');
    usersFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:ListUsers',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminDeleteUser',
        ],
        resources: [userPoolArn],
      })
    );
    route([M.GET, M.POST], '/users', usersFn);
    route([M.GET], '/users/me', usersFn);
    route([M.PUT, M.DELETE], '/users/{username}', usersFn);

    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: naming.ssm('api-url'),
      stringValue: httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
  }
}
