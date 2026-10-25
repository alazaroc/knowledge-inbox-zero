import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
  DIGEST_SLOT,
  DIGEST_SLOT_HOUR,
  TABLE_NAMES,
  type DigestSlot,
  type KnowledgeDocument,
  type Profile,
} from '@app/shared';
import { ddb } from '../lib/dynamo.js';

/**
 * Email digests — EventBridge-scheduled, NOT an API route.
 *
 * One EventBridge rule fires per time SLOT (s0/s8/s16) at its fixed UTC hour
 * (00/08/16) with a detail payload `{ "slot": "s8" }`. Each firing drives TWO
 * independent, separately-opted-in digests that share the same slot/timezone:
 *
 *   WEEKLY  — sent when (digestDay, digestSlot) matches this firing. Body is
 *             the user's worth-reading docs from the LAST 7 DAYS (what's new).
 *   MONTHLY — sent when it's the LAST day of the month (UTC) and this firing's
 *             slot matches the user's digestSlot. Body is ALL pending
 *             worth-reading docs (the backlog / history review).
 *
 * Design choice (user's): the user picks a coarse slot, not an exact hour, so
 * the backend runs at most 3 fixed times a day regardless of users/timezones.
 * The monthly digest reuses the SAME slot/timezone — no extra EventBridge rules
 * and no extra daily runs. A user with nothing to show is skipped (no empty
 * email).
 *
 * SES lives in its own region (DIGEST_SES_REGION, e.g. eu-west-1 where the
 * account is out of the sandbox and playingaws.com is a verified domain),
 * which can differ from the app region.
 */

const cognito = new CognitoIdentityProviderClient({});
const ses = new SESv2Client({ region: process.env.DIGEST_SES_REGION || process.env.AWS_REGION });

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
// Verified SES sender, e.g. "Knowledge Inbox Zero <no-reply@playingaws.com>".
const DIGEST_FROM = process.env.DIGEST_FROM ?? '';
// Public app URL so the email can deep-link back into the library.
const APP_URL = (process.env.DIGEST_APP_URL ?? '').replace(/\/+$/, '');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
// Monthly email body cap. Higher than the weekly (it's a backlog review), but
// still bounded so a huge backlog never becomes an unreadable wall of links.
const MONTHLY_CAP = 50;
const WEEKLY_CAP = 15;

type DigestKind = 'weekly' | 'monthly';

interface DigestEvent {
  slot?: DigestSlot;
}

/** Narrow an arbitrary event detail to a known slot, or undefined. */
function resolveSlot(event: DigestEvent): DigestSlot | undefined {
  return event.slot && (DIGEST_SLOT as readonly string[]).includes(event.slot)
    ? event.slot
    : undefined;
}

/** True when `date` is the last day of its month (evaluated in UTC). */
function isLastDayOfMonthUTC(date: Date): boolean {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCMonth() !== date.getUTCMonth();
}

export const handler = async (event: DigestEvent): Promise<{ sent: number; skipped: number }> => {
  const slot = resolveSlot(event);
  if (!slot) {
    console.error(JSON.stringify({ stage: 'digest', error: 'missing_or_invalid_slot', event }));
    return { sent: 0, skipped: 0 };
  }
  if (!DIGEST_FROM) {
    console.error(JSON.stringify({ stage: 'digest', error: 'DIGEST_FROM not configured' }));
    return { sent: 0, skipped: 0 };
  }

  const now = new Date();
  const today = now.getUTCDay(); // 0=Sunday..6=Saturday
  const lastDayOfMonth = isLastDayOfMonthUTC(now);

  console.log(
    JSON.stringify({
      stage: 'digest',
      slot,
      slotHour: DIGEST_SLOT_HOUR[slot],
      utcDay: today,
      lastDayOfMonth,
    })
  );

  let sent = 0;
  let skipped = 0;

  // WEEKLY: users whose chosen (day, slot) matches this firing.
  const weekly = await findRecipients({ digestEnabled: true, day: today, slot });
  for (const profile of weekly) {
    const r = await sendFor(profile, 'weekly');
    if (r) sent += 1;
    else skipped += 1;
  }

  // MONTHLY: only on the last day of the month, users opted in to the monthly
  // digest whose slot matches this firing (day-of-week is irrelevant here).
  if (lastDayOfMonth) {
    const monthly = await findRecipients({ monthlyEnabled: true, slot });
    for (const profile of monthly) {
      const r = await sendFor(profile, 'monthly');
      if (r) sent += 1;
      else skipped += 1;
    }
  }

  console.log(JSON.stringify({ stage: 'digest', slot, sent, skipped }));
  return { sent, skipped };
};

/** Send one digest of the given kind to one profile. Returns true if an email went out. */
async function sendFor(profile: Profile, kind: DigestKind): Promise<boolean> {
  try {
    const sections = await worthReadingForDigest(profile.userId, kind);
    const bodyCount =
      sections.starred.length + sections.read.length + sections.skim.length + sections.skip.length;
    if (bodyCount === 0) return false; // nothing to send → no empty email
    const email = await emailForUser(profile.userId);
    if (!email) return false;
    await sendDigestEmail(email, sections, kind);
    return true;
  } catch (err) {
    // One user's failure never blocks the rest of the run.
    console.error(
      JSON.stringify({
        stage: 'digest-send',
        kind,
        userId: profile.userId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return false;
  }
}

/** Profiles opted in to a given digest, matching this firing. Small table → scan. */
async function findRecipients(match: {
  digestEnabled?: true;
  monthlyEnabled?: true;
  day?: number;
  slot: DigestSlot;
}): Promise<Profile[]> {
  const names: Record<string, string> = { '#slot': 'digestSlot' };
  const values: Record<string, unknown> = { ':s': match.slot };
  const filters: string[] = ['#slot = :s'];

  if (match.digestEnabled) {
    names['#on'] = 'digestEnabled';
    values[':on'] = true;
    filters.push('#on = :on');
  }
  if (match.monthlyEnabled) {
    names['#mon'] = 'monthlyDigestEnabled';
    values[':mon'] = true;
    filters.push('#mon = :mon');
  }
  if (match.day !== undefined) {
    names['#day'] = 'digestDay';
    values[':d'] = match.day;
    filters.push('#day = :d');
  }

  const out: Profile[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAMES.PROFILES,
        FilterExpression: filters.join(' AND '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: startKey,
      })
    );
    for (const item of (page.Items ?? []) as Profile[]) out.push(item);
    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return out;
}

/**
 * The owner's documents grouped into the sections the email renders:
 *  - `starred`: the user's own "To read" picks — their intent wins, shown first.
 *  - `read` / `skim`: the AI's worth-reading verdicts.
 *  - `skip`: the AI said skip — folded/summarized so the user can still spot a
 *    "the AI skipped this but it's actually for me".
 * WEEKLY scopes read/skim/skip to the last 7 days (what's new); MONTHLY takes
 * everything pending (backlog review). Starred is always included regardless of
 * age (it's an explicit pick). `total` is the full non-archived count, for the
 * footer nudge. Reads the byOwnerState GSI for each state.
 */
interface DigestSections {
  starred: KnowledgeDocument[];
  read: KnowledgeDocument[];
  skim: KnowledgeDocument[];
  skip: KnowledgeDocument[];
  total: number;
}

function sortByMkv(docs: KnowledgeDocument[]): KnowledgeDocument[] {
  return docs.sort((a, b) => (b.scores?.mkv ?? 0) - (a.scores?.mkv ?? 0));
}

async function worthReadingForDigest(ownerId: string, kind: DigestKind): Promise<DigestSections> {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const recentEnough = (d: KnowledgeDocument) => {
    if (kind === 'monthly') return true;
    const updated = Date.parse(d.updatedAt ?? '');
    return !Number.isNaN(updated) && updated >= cutoff;
  };

  const starred: KnowledgeDocument[] = [];
  const read: KnowledgeDocument[] = [];
  const skim: KnowledgeDocument[] = [];
  const skip: KnowledgeDocument[] = [];
  let total = 0;

  for (const state of ['READ', 'SKIM', 'SKIP'] as const) {
    const r = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAMES.DOCUMENTS,
        IndexName: 'byOwnerState',
        KeyConditionExpression: 'ownerId = :o AND begins_with(stateKey, :s)',
        ExpressionAttributeValues: { ':o': ownerId, ':s': `${state}#` },
      })
    );
    for (const doc of (r.Items ?? []) as KnowledgeDocument[]) {
      if (doc.archived) continue;
      if (state !== 'SKIP') total += 1; // worth-reading backlog = READ + SKIM
      // The user's own "To read" wins — list it in the starred section even if
      // the AI said SKIP, and don't duplicate it in the state sections.
      if (doc.starred) {
        starred.push(doc);
        continue;
      }
      if (!recentEnough(doc)) continue;
      if (state === 'READ') read.push(doc);
      else if (state === 'SKIM') skim.push(doc);
      else skip.push(doc);
    }
  }

  sortByMkv(starred);
  sortByMkv(read);
  sortByMkv(skim);
  sortByMkv(skip);

  const cap = kind === 'monthly' ? MONTHLY_CAP : WEEKLY_CAP;
  return {
    starred: starred.slice(0, cap),
    read: read.slice(0, cap),
    skim: skim.slice(0, cap),
    skip: skip.slice(0, cap),
    total,
  };
}

/** Resolve a user's email from Cognito by their sub (the owner id). */
async function emailForUser(sub: string): Promise<string | undefined> {
  if (!USER_POOL_ID) return undefined;
  const r = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${sub}"`,
      Limit: 1,
    })
  );
  const attrs = r.Users?.[0]?.Attributes ?? [];
  return attrs.find((a) => a.Name === 'email')?.Value;
}

/** Minimal HTML escaping for values interpolated into the email body. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Copy that differs between the weekly and monthly digest. */
function copyFor(kind: DigestKind, worthCount: number) {
  if (kind === 'monthly') {
    return {
      subject: `Your reading backlog — ${worthCount} worth it`,
      heading: 'Your monthly reading review',
      intro: `${worthCount} worth reading still pending across your whole library.`,
    };
  }
  return {
    subject: `Your weekly reading — ${worthCount} worth it`,
    heading: 'Your weekly reading',
    intro: `${worthCount} worth reading from the last 7 days.`,
  };
}

const APP_LINK = APP_URL ? `${APP_URL}/app/library` : '';

/** Full detail row for a READ / starred item: title + why + what + key claims. */
function detailRow(d: KnowledgeDocument): string {
  const title = esc(d.metadata?.title?.trim() || d.canonicalUrl || d.rawUrl || 'Untitled');
  const url = esc(d.canonicalUrl || d.rawUrl || '#');
  const mkv = typeof d.scores?.mkv === 'number' ? `MKV ${d.scores.mkv}` : '';
  const why = d.explanationUnavailable ? '' : esc((d.explanation ?? '').trim());
  const what = esc((d.extraction?.summary ?? '').trim());
  const claims = (d.extraction?.claims ?? []).slice(0, 5).map((c) => esc(c.trim()));
  return `
    <tr><td style="padding:14px 0;border-bottom:1px solid #eee;">
      <div style="font-size:12px;color:#6366f1;font-weight:600;">${mkv}</div>
      <a href="${url}" style="font-size:16px;font-weight:600;color:#111;text-decoration:none;">${title}</a>
      ${why ? `<div style="font-size:13px;color:#555;margin-top:6px;"><strong>Why for you:</strong> ${why}</div>` : ''}
      ${what ? `<div style="font-size:13px;color:#555;margin-top:4px;"><strong>What it says:</strong> ${what}</div>` : ''}
      ${
        claims.length
          ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;color:#555;">${claims
              .map((c) => `<li>${c}</li>`)
              .join('')}</ul>`
          : ''
      }
    </td></tr>`;
}

/** Compact one-line row for SKIM / SKIP items: title + short note. */
function compactRow(d: KnowledgeDocument): string {
  const title = esc(d.metadata?.title?.trim() || d.canonicalUrl || d.rawUrl || 'Untitled');
  const url = esc(d.canonicalUrl || d.rawUrl || '#');
  const why = d.explanationUnavailable ? '' : esc((d.explanation ?? '').trim());
  return `
    <tr><td style="padding:8px 0;border-bottom:1px solid #f1f1f1;">
      <a href="${url}" style="font-size:14px;font-weight:600;color:#111;text-decoration:none;">${title}</a>
      ${why ? `<div style="font-size:12px;color:#777;margin-top:2px;">${why}</div>` : ''}
    </td></tr>`;
}

function sectionHtml(heading: string, note: string, rows: string): string {
  if (!rows) return '';
  return `
    <h2 style="font-size:14px;color:#111;margin:28px 0 2px;">${heading}</h2>
    ${note ? `<p style="font-size:12px;color:#999;margin:0 0 6px;">${note}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

/** Build and send one digest email via SES. */
async function sendDigestEmail(
  to: string,
  sections: DigestSections,
  kind: DigestKind
): Promise<void> {
  const worthCount = sections.read.length + sections.skim.length;
  const { subject, heading, intro } = copyFor(kind, worthCount);

  const starredHtml = sectionHtml(
    '★ Your “to read” list',
    'Items you picked — your call beats the AI’s.',
    sections.starred.map(detailRow).join('')
  );
  const readHtml = sectionHtml('Worth reading', '', sections.read.map(detailRow).join(''));
  const skimHtml = sectionHtml('Worth a skim', '', sections.skim.map(compactRow).join(''));
  // SKIP folded into a <details> so it never pads the body, but is there in
  // case the AI skipped something that's actually for you.
  const skipRows = sections.skip.map(compactRow).join('');
  const skipHtml = skipRows
    ? `<details style="margin-top:28px;"><summary style="font-size:14px;color:#111;cursor:pointer;">The AI skipped ${sections.skip.length} — open in case one is for you</summary>
       <table style="width:100%;border-collapse:collapse;margin-top:6px;">${skipRows}</table></details>`
    : '';

  const olderCount = Math.max(0, sections.total - sections.read.length - sections.skim.length);
  const backlogLine =
    olderCount > 0
      ? `<p style="font-size:13px;color:#555;margin:20px 0 0;">You also have <strong>${olderCount}</strong> more worth-reading item${
          olderCount === 1 ? '' : 's'
        }${APP_LINK ? ` — <a href="${esc(APP_LINK)}" style="color:#6366f1;">see them in your library</a>` : ''}.</p>`
      : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="max-width:620px;margin:0 auto;padding:24px;">
      <h1 style="font-size:18px;color:#111;margin:0 0 4px;">${heading}</h1>
      <p style="font-size:14px;color:#555;margin:0 0 8px;">${intro}</p>
      ${starredHtml}
      ${readHtml}
      ${skimHtml}
      ${skipHtml}
      ${backlogLine}
      ${APP_LINK ? `<p style="margin-top:28px;"><a href="${esc(APP_LINK)}" style="background:#6366f1;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Open your library</a></p>` : ''}
      <p style="font-size:12px;color:#999;margin-top:24px;">You can turn this digest off in Settings → Notifications.</p>
    </div>
  </body></html>`;

  const line = (d: KnowledgeDocument) =>
    `• ${d.metadata?.title?.trim() || d.canonicalUrl || d.rawUrl}\n  ${d.canonicalUrl || d.rawUrl}`;
  const textParts: string[] = [`${heading} — ${worthCount} worth reading.`];
  if (sections.starred.length)
    textParts.push(`\n★ To read:\n${sections.starred.map(line).join('\n')}`);
  if (sections.read.length)
    textParts.push(`\nWorth reading:\n${sections.read.map(line).join('\n')}`);
  if (sections.skim.length)
    textParts.push(`\nWorth a skim:\n${sections.skim.map(line).join('\n')}`);
  if (sections.skip.length)
    textParts.push(
      `\nThe AI skipped ${sections.skip.length}:\n${sections.skip.map(line).join('\n')}`
    );
  if (olderCount > 0) textParts.push(`\nYou also have ${olderCount} more worth-reading item(s).`);
  if (APP_LINK) textParts.push(`\nOpen your library: ${APP_LINK}`);
  const text = textParts.join('\n');

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: DIGEST_FROM,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Html: { Data: html }, Text: { Data: text } },
        },
      },
    })
  );
}
