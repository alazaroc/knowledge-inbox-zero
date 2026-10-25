import type { PreSignUpTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient({});

// Pre-signup trigger with two jobs:
//
// 1. NATIVE sign-up (email/password): auto-confirm the account so new users
//    enter the app immediately, with NO mandatory email-verification step
//    (lower friction, less abandonment). Email verification is offered later
//    as a non-blocking in-app banner. We deliberately leave email_verified=false
//    so that banner shows and a real verification path (and password reset)
//    stays available.
//
// 2. EXTERNAL provider (Google): account linking. When someone signs in with
//    Google using an email that ALREADY exists as a native account, Cognito
//    would otherwise create a duplicate federated user. We detect that case and
//    link the Google identity to the existing user with AdminLinkProviderForUser
//    so both sign-in methods resolve to the SAME account (same `sub`), keeping
//    all their documents/profile. Linking is keyed by email: safe because
//    Google emails arrive verified and native sign-ups require a verified email.
export const handler: PreSignUpTriggerHandler = async (event) => {
  // Native sign-up: auto-confirm, leave email unverified (drives the in-app banner).
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = false;
    event.response.autoVerifyPhone = false;
    return event;
  }

  // External provider (Google) from here on.
  const email = event.request.userAttributes.email;
  if (!email) {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
    return event;
  }

  // userName arrives as "<Provider>_<sub>", e.g. "Google_103845...".
  const separator = event.userName.indexOf('_');
  const providerName = event.userName.slice(0, separator);
  const providerUserId = event.userName.slice(separator + 1);

  // Is there already a user with this email?
  const { Users = [] } = await client.send(
    new ListUsersCommand({
      UserPoolId: event.userPoolId,
      Filter: `email = "${email}"`,
      Limit: 1,
    })
  );

  const existing = Users[0];

  // No prior account: ordinary federated sign-up. Confirm + verify, no friction.
  if (!existing?.Username) {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
    return event;
  }

  // A native user has Username = sub (no "_"); a federated one is "Google_...".
  const destinationIsNative = !existing.Username.includes('_');

  await client.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: event.userPoolId,
      DestinationUser: {
        ProviderName: destinationIsNative ? 'Cognito' : providerName,
        ProviderAttributeValue: existing.Username,
      },
      SourceUser: {
        ProviderName: providerName,
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: providerUserId,
      },
    })
  );

  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
