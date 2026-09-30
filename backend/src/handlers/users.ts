import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  ROLES,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  type AdminUserSummary,
} from '@app/shared';
import { authenticate, parseBody } from '../lib/handler-utils.js';
import { badRequest, created, forbidden, noContent, ok, serverError } from '../lib/response.js';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;

/**
 * User management (backed by Cognito). All routes except /users/me
 * require the ADMIN role.
 * - GET    /users            → list users
 * - POST   /users            → create user (email, temporary password, role)
 * - GET    /users/me         → authenticated user's profile
 * - PUT    /users/{username} → enable/disable or change role
 * - DELETE /users/{username} → delete user
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const username = event.pathParameters?.username;
    const path = event.resource || event.path || '';

    const auth = await authenticate(event);
    if ('error' in auth) return auth.error;

    if (method === 'GET' && path.endsWith('/me')) {
      return ok({ sub: auth.ctx.sub, email: auth.ctx.email, role: auth.ctx.role });
    }

    // The remaining operations are administrative.
    if (auth.ctx.role !== ROLES.ADMIN) return forbidden();

    if (method === 'GET' && !username) return listUsers();
    if (method === 'POST' && !username) return createUser(event);
    if (method === 'PUT' && username) return updateUser(event, username);
    if (method === 'DELETE' && username) return deleteUser(username);

    return badRequest('Unrecognized route');
  } catch (err) {
    return serverError(err);
  }
};

const attr = (u: UserType, name: string) => u.Attributes?.find((a) => a.Name === name)?.Value ?? '';

function toSummary(u: UserType): AdminUserSummary {
  return {
    username: u.Username ?? '',
    email: attr(u, 'email'),
    role: (attr(u, 'custom:role') as AdminUserSummary['role']) || ROLES.USER,
    enabled: u.Enabled ?? false,
    status: u.UserStatus ?? 'UNKNOWN',
    createdAt: u.UserCreateDate?.toISOString(),
  };
}

async function listUsers(): Promise<APIGatewayProxyResult> {
  const r = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: 60 }));
  return ok({ items: (r.Users ?? []).map(toSummary) });
}

async function createUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event, adminCreateUserSchema);
  if ('error' in body) return body.error;
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: body.data.email,
      TemporaryPassword: body.data.password,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: body.data.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:role', Value: body.data.role },
      ],
    })
  );
  return created({ username: body.data.email, role: body.data.role });
}

async function updateUser(
  event: APIGatewayProxyEvent,
  username: string
): Promise<APIGatewayProxyResult> {
  const body = parseBody(event, adminUpdateUserSchema);
  if ('error' in body) return body.error;

  if (body.data.role) {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [{ Name: 'custom:role', Value: body.data.role }],
      })
    );
  }
  if (body.data.enabled === true) {
    await cognito.send(
      new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
    );
  } else if (body.data.enabled === false) {
    await cognito.send(
      new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
    );
  }
  return ok({ username });
}

async function deleteUser(username: string): Promise<APIGatewayProxyResult> {
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  return noContent();
}
