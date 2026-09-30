import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, itemCreateSchema, itemUpdateSchema, type Item } from '@app/shared';
import { ddb } from '../lib/dynamo.js';
import { authenticate, authorizeItem, parseBody } from '../lib/handler-utils.js';
import { badRequest, created, noContent, notFound, ok, serverError } from '../lib/response.js';
import { newId, now } from '../lib/ids.js';

/**
 * CRUD for the example `Item` entity.
 * - GET    /items                → lists the user's items (owned + shared)
 * - POST   /items                → creates an item (the user becomes owner)
 * - GET    /items/{itemId}       → detail (requires read)
 * - PUT    /items/{itemId}       → update (requires write)
 * - DELETE /items/{itemId}       → delete (owner only; also removes its shares)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const itemId = event.pathParameters?.itemId;

    if (method === 'GET' && !itemId) return listItems(event);
    if (method === 'POST' && !itemId) return createItem(event);
    if (method === 'GET' && itemId) return getItem(event);
    if (method === 'PUT' && itemId) return updateItem(event);
    if (method === 'DELETE' && itemId) return deleteItem(event);

    return badRequest('Unrecognized route');
  } catch (err) {
    return serverError(err);
  }
};

async function listItems(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;

  // Owned items (GSI byOwner).
  const owned = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAMES.ITEMS,
      IndexName: 'byOwner',
      KeyConditionExpression: 'ownerId = :o',
      ExpressionAttributeValues: { ':o': auth.ctx.sub },
    })
  );

  // Items shared with the user (GSI byUser on shares → GetItem for each one).
  const shared = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAMES.SHARES,
      IndexName: 'byUser',
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': auth.ctx.sub },
    })
  );
  const sharedItems = await Promise.all(
    (shared.Items ?? []).map(async (s) => {
      const r = await ddb.send(
        new GetCommand({ TableName: TABLE_NAMES.ITEMS, Key: { itemId: s.itemId } })
      );
      return r.Item as Item | undefined;
    })
  );

  const items = [...(owned.Items ?? []), ...sharedItems.filter(Boolean)] as Item[];
  return ok({ items });
}

async function createItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authenticate(event);
  if ('error' in auth) return auth.error;
  const body = parseBody(event, itemCreateSchema);
  if ('error' in body) return body.error;

  const ts = now();
  const item: Item = {
    itemId: newId(),
    ownerId: auth.ctx.sub,
    name: body.data.name,
    description: body.data.description,
    status: body.data.status,
    createdAt: ts,
    updatedAt: ts,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAMES.ITEMS, Item: item }));
  return created(item);
}

async function getItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authorizeItem(event, 'read');
  if ('error' in auth) return auth.error;
  const r = await ddb.send(
    new GetCommand({ TableName: TABLE_NAMES.ITEMS, Key: { itemId: auth.itemId } })
  );
  if (!r.Item) return notFound('Item');
  return ok(r.Item);
}

async function updateItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authorizeItem(event, 'write');
  if ('error' in auth) return auth.error;
  const body = parseBody(event, itemUpdateSchema);
  if ('error' in body) return body.error;
  const entries = Object.entries(body.data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return badRequest('Nothing to update');

  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    sets.push(`#${k} = :${k}`);
    names[`#${k}`] = k;
    values[`:${k}`] = v;
  }
  sets.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = now();

  const r = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAMES.ITEMS,
      Key: { itemId: auth.itemId },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    })
  );
  return ok(r.Attributes);
}

async function deleteItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const auth = await authorizeItem(event, 'owner');
  if ('error' in auth) return auth.error;

  // Cascade: remove the item's shares before deleting it.
  const shares = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAMES.SHARES,
      KeyConditionExpression: 'itemId = :i',
      ExpressionAttributeValues: { ':i': auth.itemId },
      ProjectionExpression: 'itemId, userId',
    })
  );
  await Promise.all(
    (shares.Items ?? []).map((s) =>
      ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAMES.SHARES,
          Key: { itemId: s.itemId, userId: s.userId },
        })
      )
    )
  );

  await ddb.send(new DeleteCommand({ TableName: TABLE_NAMES.ITEMS, Key: { itemId: auth.itemId } }));
  return noContent();
}
