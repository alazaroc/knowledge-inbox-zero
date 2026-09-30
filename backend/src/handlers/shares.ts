import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, itemShareSchema, type ItemShare } from '@app/shared';
import { ddb } from '../lib/dynamo.js';
import { authorizeItem, parseBody } from '../lib/handler-utils.js';
import { badRequest, created, noContent, ok, serverError } from '../lib/response.js';
import { now } from '../lib/ids.js';

/**
 * Manage shared access to an item.
 * - GET    /items/{itemId}/shares            → list (requires read on the item)
 * - POST   /items/{itemId}/shares            → share (owner only)
 * - DELETE /items/{itemId}/shares/{userId}   → revoke (owner only)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const targetUserId = event.pathParameters?.userId;

    if (method === 'GET' && !targetUserId) return listShares(event);
    if (method === 'POST' && !targetUserId) return addShare(event);
    if (method === 'DELETE' && targetUserId) return removeShare(event, targetUserId);

    return badRequest('Unrecognized route');
  } catch (err) {
    return serverError(err);
  }
};

async function listShares(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authorizeItem(event, 'read');
  if ('error' in auth) return auth.error;
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAMES.SHARES,
      KeyConditionExpression: 'itemId = :i',
      ExpressionAttributeValues: { ':i': auth.itemId },
    })
  );
  return ok({ items: r.Items ?? [] });
}

async function addShare(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authorizeItem(event, 'owner');
  if ('error' in auth) return auth.error;
  const body = parseBody(event, itemShareSchema);
  if ('error' in body) return body.error;

  const ts = now();
  const share: ItemShare = {
    itemId: auth.itemId,
    userId: body.data.userId,
    permission: body.data.permission,
    createdAt: ts,
    updatedAt: ts,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAMES.SHARES, Item: share }));
  return created(share);
}

async function removeShare(
  event: APIGatewayProxyEvent,
  targetUserId: string
): Promise<APIGatewayProxyResult> {
  const auth = await authorizeItem(event, 'owner');
  if ('error' in auth) return auth.error;
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAMES.SHARES,
      Key: { itemId: auth.itemId, userId: targetUserId },
    })
  );
  return noContent();
}
