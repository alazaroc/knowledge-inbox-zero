import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';
import { ResourceNaming } from './naming';

interface AuthStackProps extends cdk.StackProps {
  naming: ResourceNaming;
}

export class AuthStack extends cdk.Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { naming } = props;

    // Pre-signup trigger: auto-confirm new accounts so users enter the app
    // without a mandatory email-verification step (verification becomes a
    // non-blocking in-app banner instead). See backend/src/handlers/pre-signup.ts.
    const preSignUpFn = new NodejsFunction(this, 'PreSignUpFn', {
      functionName: naming.standard('pre-signup'),
      entry: path.join(__dirname, '../../../backend/src/handlers/pre-signup.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: { externalModules: ['@aws-sdk/*'], minify: true },
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    });

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: naming.standard('users'),
      selfSignUpEnabled: true, // public sign-up (self-registration) enabled
      signInAliases: { email: true },
      autoVerify: { email: true },
      lambdaTriggers: { preSignUp: preSignUpFn },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      // MFA disabled: sign-in is CREDENTIALS -> (NEW_PASSWORD/RESET_PASSWORD) -> DONE.
      mfa: cognito.Mfa.OFF,
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: naming.standard('web-client'),
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, emailVerified: true })
        .withCustomAttributes('role'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true })
        .withCustomAttributes('role'),
    });

    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: naming.ssm('user-pool-id'),
      stringValue: this.userPool.userPoolId,
    });
    new ssm.StringParameter(this, 'UserPoolClientIdParam', {
      parameterName: naming.ssm('user-pool-client-id'),
      stringValue: this.userPoolClient.userPoolClientId,
    });
    new ssm.StringParameter(this, 'UserPoolArnParam', {
      parameterName: naming.ssm('user-pool-arn'),
      stringValue: this.userPool.userPoolArn,
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
