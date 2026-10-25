import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import type { Profile } from '@app/shared';
import { api } from '../../lib/api';
import PageLoader from '../../components/ui/PageLoader';
import {
  digestSlotOptions,
  COMMON_TIMEZONES,
  closestKnownTimezone,
  resolveDefaultTimezone,
} from '../../lib/digest-ui';

type DigestSlot = 's0' | 's8' | 's16';
type DigestDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Notifications live apart from the Knowledge profile (which is "info about
// you") and from My account (identity). This page edits ONLY the email-digest
// preferences, then saves the WHOLE profile back (the rest untouched) because
// PUT /profile is replace-all.
export default function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const [digestEnabled, setDigestEnabled] = useState(false);
  const [monthlyDigestEnabled, setMonthlyDigestEnabled] = useState(false);
  const [digestDay, setDigestDay] = useState<DigestDay>(0);
  const [digestSlot, setDigestSlot] = useState<DigestSlot>('s8');
  const [digestTimezone, setDigestTimezone] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const p = await api.get<Profile>('/profile');
        if (!active) return;
        setProfile(p);
        setDigestEnabled(p.digestEnabled ?? false);
        setMonthlyDigestEnabled(p.monthlyDigestEnabled ?? false);
        setDigestDay((p.digestDay ?? 0) as DigestDay);
        setDigestSlot((p.digestSlot ?? 's8') as DigestSlot);
        setDigestTimezone(resolveDefaultTimezone(p.digestTimezone));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSave = async () => {
    if (!profile) return;
    setSaving(true);
    setNotice('');
    try {
      // Send the whole profile back (replace-all), overriding only the digest
      // fields with the edited values.
      await api.put('/profile', {
        highInterests: profile.highInterests ?? [],
        mediumInterests: profile.mediumInterests ?? [],
        currentlyResearching: profile.currentlyResearching ?? [],
        alreadyKnown: profile.alreadyKnown ?? [],
        avoidContentTypes: profile.avoidContentTypes ?? [],
        activeContexts: profile.activeContexts ?? [],
        context: profile.context ?? '',
        profileSourceUrl: profile.profileSourceUrl ?? '',
        profileRepoUrl: profile.profileRepoUrl ?? '',
        outputLanguage: profile.outputLanguage ?? 'auto',
        digestEnabled,
        monthlyDigestEnabled,
        digestDay,
        digestSlot,
        digestTimezone,
      });
      setNotice('Saved.');
    } catch {
      setNotice('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  const anyDigest = digestEnabled || monthlyDigestEnabled;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          <Bell className="h-5 w-5 text-indigo-600" />
          Notifications
        </h1>
        <p className="text-sm text-gray-500">
          Email digests of what’s worth your attention. Nothing else emails you.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={digestEnabled}
            onChange={(e) => setDigestEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="block text-sm font-semibold text-gray-800">Weekly email digest</span>
            <span className="block text-xs text-gray-500">
              The week’s worth-reading links, plus your “to read” picks. We skip the email on a week
              with nothing new.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={monthlyDigestEnabled}
            onChange={(e) => setMonthlyDigestEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="block text-sm font-semibold text-gray-800">Monthly email digest</span>
            <span className="block text-xs text-gray-500">
              On the last day of each month, everything still worth reading in your library — a
              backlog review. Uses the same time + timezone below.
            </span>
          </span>
        </label>

        {anyDigest && (
          <div className="flex flex-wrap items-end gap-4 pl-7">
            {digestEnabled && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Day (weekly)</span>
                <select
                  className="input cursor-pointer"
                  value={digestDay}
                  onChange={(e) => setDigestDay(Number(e.target.value) as DigestDay)}
                >
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                  <option value={0}>Sunday</option>
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                Time (your local time)
              </span>
              <select
                className="input cursor-pointer"
                value={digestSlot}
                onChange={(e) => setDigestSlot(e.target.value as DigestSlot)}
              >
                {digestSlotOptions(digestTimezone).map((o) => (
                  <option key={o.slot} value={o.slot}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Timezone</span>
              <select
                className="input cursor-pointer"
                value={
                  COMMON_TIMEZONES.some((t) => t.value === digestTimezone)
                    ? digestTimezone
                    : closestKnownTimezone(digestTimezone)
                }
                onChange={(e) => setDigestTimezone(e.target.value)}
              >
                {COMMON_TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="w-full text-xs text-gray-400">
              We send at three fixed moments a day; the times above are shown in your timezone, so
              you always know when it really arrives. The monthly digest goes out at the same time
              on the last day of the month.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="cursor-pointer rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save notifications'}
        </button>
        {notice && <span className="text-sm text-gray-600">{notice}</span>}
      </div>
    </div>
  );
}
