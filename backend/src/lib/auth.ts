import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ROLES, type Role } from '@app/shared';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

export interface AuthContext {
  sub: string;
  email: string;
  role: Role;
}

/** Verifies the Cognito JWT (id token) from the Authorization header. */
export async function verifyToken(event: APIGatewayProxyEvent): Promise<AuthContext | null> {
  const header = event.headers?.Authorization ?? event.headers?.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifier.verify(header.slice(7));
    const role = (payload['custom:role'] as Role) ?? ROLES.USER;
    const email = (payload['email'] as string) ?? '';
    return { sub: payload.sub, email, role };
  } catch {
    return null;
  }
}

export const isAdmin = (ctx: AuthContext) => ctx.role === ROLES.ADMIN;
