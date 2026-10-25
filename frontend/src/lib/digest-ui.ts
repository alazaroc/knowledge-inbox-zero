import { DIGEST_SLOT, DIGEST_SLOT_HOUR } from '@app/shared';

// The digest sends at three FIXED UTC hours (00/08/16). This renders each slot
// as the user's LOCAL time in their chosen timezone — so a +2 user sees the
// 08:00-UTC slot as "10:00". Uses Intl so DST is handled correctly (not a naive
// offset). Returns the slots sorted by their local hour, each with a label.
export function digestSlotOptions(
  timezone: string
): { slot: (typeof DIGEST_SLOT)[number]; label: string; localHour: number }[] {
  const tz = timezone || 'UTC';
  const fmt = (utcHour: number): { label: string; localHour: number } => {
    const d = new Date(Date.UTC(2025, 0, 6, utcHour, 0, 0)); // a Monday
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
      return { label: `${hh}:${mm}`, localHour: Number(hh) };
    } catch {
      return { label: `${String(utcHour).padStart(2, '0')}:00`, localHour: utcHour };
    }
  };
  return DIGEST_SLOT.map((slot) => {
    const { label, localHour } = fmt(DIGEST_SLOT_HOUR[slot]);
    return { slot, label, localHour };
  }).sort((a, b) => a.localHour - b.localHour);
}

// The ~10 best-known IANA timezones offered in the digest picker, with
// human-readable labels (users don't know IANA names). A user outside these is
// a rare case; they're mapped to the closest offered zone by UTC offset.
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Madrid', label: 'Madrid / Paris / Berlin (CET)' },
  { value: 'Europe/London', label: 'London / Lisbon (GMT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York / Toronto (ET)' },
  { value: 'America/Chicago', label: 'Chicago / Mexico City (CT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles / Vancouver (PT)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (ART)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo / Seoul (JST)' },
];

// Current UTC offset of an IANA timezone, in minutes (DST-aware, "now").
// Returns null for an invalid id.
export function offsetMinutesFor(timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return name.includes('GMT') ? 0 : null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
  } catch {
    return null;
  }
}

// The OFFERED timezone whose current UTC offset is closest to the given tz's
// real offset (DST-aware), so an unlisted zone maps to a nearby known one
// (America/Argentina/Cordoba → Buenos Aires). Falls back to UTC.
export function closestKnownTimezone(timezone: string): string {
  const target = offsetMinutesFor(timezone);
  if (target === null) return 'UTC';
  let best = 'UTC';
  let bestDiff = Infinity;
  for (const t of COMMON_TIMEZONES) {
    const off = offsetMinutesFor(t.value);
    if (off === null) continue;
    const diff = Math.abs(off - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t.value;
    }
  }
  return best;
}

// Pick the stored tz if set; otherwise the browser's own tz when offered;
// otherwise the closest offered zone by offset; finally UTC.
export function resolveDefaultTimezone(stored?: string): string {
  if (stored) return stored;
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (browser && COMMON_TIMEZONES.some((t) => t.value === browser)) return browser;
  return browser ? closestKnownTimezone(browser) : 'UTC';
}
