import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
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

    // --- Optional Google SSO (open-source friendly) -------------------------
    // Google is wired ONLY when its OAuth credentials are supplied via context:
    //   cdk deploy -c googleClientId=... -c googleClientSecret=...
    // Without them, synth/deploy produce a plain email+password pool — so anyone
    // who clones this repo gets a working pool with no secret of ours baked in.
    // The Hosted UI domain prefix and the app callback URLs are also contextual.
    const googleClientId = this.node.tryGetContext('googleClientId') as string | undefined;
    const googleClientSecret = this.node.tryGetContext('googleClientSecret') as string | undefined;
    const hostedUiPrefix =
      (this.node.tryGetContext('hostedUiPrefix') as string | undefined) ?? naming.standard('auth');
    // Comma-separated allowed callback/logout URLs (the app origins). Falls back
    // to localhost for a clone with no domain yet.
    const callbackUrlsRaw =
      (this.node.tryGetContext('authCallbackUrls') as string | undefined) ??
      'http://localhost:5173/';
    const callbackUrls = callbackUrlsRaw
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const googleEnabled = Boolean(googleClientId && googleClientSecret);

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

    // The pre-signup trigger links a federated (Google) sign-up to an existing
    // native user of the same email. Grant it the minimal rights to search and
    // link users in THIS pool. Attached as a SEPARATE inline policy (not inline
    // on the role at construction) to avoid a pool -> fn -> role -> pool cycle.
    preSignUpFn.role?.attachInlinePolicy(
      new iam.Policy(this, 'PreSignUpLinkPolicy', {
        statements: [
          new iam.PolicyStatement({
            actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'],
            resources: [this.userPool.userPoolArn],
          }),
        ],
      })
    );

    // Google identity provider (optional). Map Google's email/name onto the
    // standard Cognito attributes so a Google sign-in populates the profile.
    let googleIdp: cognito.UserPoolIdentityProviderGoogle | undefined;
    let hostedUiDomain: cognito.UserPoolDomain | undefined;
    if (googleEnabled) {
      googleIdp = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdP', {
        userPool: this.userPool,
        clientId: googleClientId!,
        clientSecretValue: cdk.SecretValue.unsafePlainText(googleClientSecret!),
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME,
          // email_verified matters for account linking: we trust Google verified the email.
          emailVerified: cognito.ProviderAttribute.other('email_verified'),
        },
      });

      // Hosted UI domain — required for the OAuth (Google) redirect flow.
      hostedUiDomain = this.userPool.addDomain('HostedUiDomain', {
        cognitoDomain: { domainPrefix: hostedUiPrefix },
      });
    }

    // Identity providers the web client accepts: always Cognito (email/pass),
    // plus Google when enabled.
    const supportedIdentityProviders = [
      cognito.UserPoolClientIdentityProvider.COGNITO,
      ...(googleEnabled ? [cognito.UserPoolClientIdentityProvider.GOOGLE] : []),
    ];

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
      supportedIdentityProviders,
      ...(googleEnabled
        ? {
            oAuth: {
              flows: { authorizationCodeGrant: true },
              scopes: [
                cognito.OAuthScope.OPENID,
                cognito.OAuthScope.EMAIL,
                cognito.OAuthScope.PROFILE,
              ],
              callbackUrls,
              logoutUrls: callbackUrls,
            },
          }
        : {}),
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, emailVerified: true })
        .withCustomAttributes('role'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true })
        .withCustomAttributes('role'),
    });

    // The client must not be created before the Google IdP exists, or the
    // first deploy races and rejects GOOGLE as an unknown provider.
    if (googleIdp) {
      this.userPoolClient.node.addDependency(googleIdp);
    }

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

    // Hosted UI domain (only when Google SSO is enabled). The frontend reads
    // this as VITE_COGNITO_DOMAIN to light up the "Continue with Google" button
    // and run the OAuth redirect flow; absent it, the button stays hidden.
    if (hostedUiDomain) {
      const domainUrl = `${hostedUiPrefix}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`;
      new ssm.StringParameter(this, 'HostedUiDomainParam', {
        parameterName: naming.ssm('hosted-ui-domain'),
        stringValue: domainUrl,
      });
      new cdk.CfnOutput(this, 'HostedUiDomain', { value: domainUrl });
    }
  }
}
