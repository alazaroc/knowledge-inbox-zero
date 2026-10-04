import type { PreSignUpTriggerHandler } from 'aws-lambda';

// Pre-signup trigger: auto-confirm the account so new users enter the app
// immediately, with NO mandatory email-verification step (lower friction, less
// abandonment). Email verification is offered later as a non-blocking banner
// inside the app. We deliberately do NOT auto-verify the email here — leaving
// email_verified=false is what drives that banner and keeps a real
// verification path available (and password reset still e-mails a code).
export const handler: PreSignUpTriggerHandler = async (event) => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = false;
  event.response.autoVerifyPhone = false;
  return event;
};
