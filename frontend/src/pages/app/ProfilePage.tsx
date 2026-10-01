import { useEffect, useMemo, useState } from 'react';
import type { Profile, ProfileInput } from '@app/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// The five profile lists are edited as free text, one entry per line. The
// backend schema trims entries and drops blanks, so the editor stays simple.
const LIST_FIELDS = [
  {
    key: 'highInterests',
    label: 'High interests',
    hint: 'Topics you care most about. One per line.',
  },
  {
    key: 'mediumInterests',
    label: 'Medium interests',
    hint: 'Topics worth some attention. One per line.',
  },
  {
    key: 'currentlyResearching',
    label: 'Currently researching',
    hint: 'What you are actively digging into right now. One per line.',
  },
  {
    key: 'alreadyKnown',
    label: 'Already known',
    hint: 'Topics you already know well, so similar content is lower priority. One per line.',
  },
  {
    key: 'avoidContentTypes',
    label: 'Avoid content types',
    hint: 'Kinds of content you would rather not see. One per line.',
  },
] as const;

type ListKey = (typeof LIST_FIELDS)[number]['key'];

// Local form shape: lists are held as raw multi-line strings while editing.
interface FormState {
  highInterests: string;
  mediumInterests: string;
  currentlyResearching: string;
  alreadyKnown: string;
  avoidContentTypes: string;
  context: string;
}

const EMPTY_FORM: FormState = {
  highInterests: '',
  mediumInterests: '',
  currentlyResearching: '',
  alreadyKnown: '',
  avoidContentTypes: '',
  context: '',
};

const linesToForm = (list: string[]): string => list.join('\n');

// Split a textarea into trimmed, non-empty entries. The backend repeats this
// normalization (and enforces bounds), so this is purely for the request body.
const formToLines = (value: string): string[] =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

function profileToForm(profile: Profile): FormState {
  return {
    highInterests: linesToForm(profile.highInterests),
    mediumInterests: linesToForm(profile.mediumInterests),
    currentlyResearching: linesToForm(profile.currentlyResearching),
    alreadyKnown: linesToForm(profile.alreadyKnown),
    avoidContentTypes: linesToForm(profile.avoidContentTypes),
    context: profile.context ?? '',
  };
}

export default function ProfilePage() {
  const { user } = useAuth();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // True until a real profile has been saved — drives the empty-state prompt (Req 8.2).
  const [notConfigured, setNotConfigured] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const profile = await api.get<Profile>('/profile');
      setForm(profileToForm(profile));
      setNotConfigured(Boolean(profile.notConfigured));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load once on mount; the shared api client handles retry/backoff (Req 8.12).
    void load();
  }, []);

  const update = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const payload: ProfileInput = {
        highInterests: formToLines(form.highInterests),
        mediumInterests: formToLines(form.mediumInterests),
        currentlyResearching: formToLines(form.currentlyResearching),
        alreadyKnown: formToLines(form.alreadyKnown),
        avoidContentTypes: formToLines(form.avoidContentTypes),
        context: form.context.trim() ? form.context.trim() : undefined,
      };
      const updated = await api.put<Profile>('/profile', payload);
      setForm(profileToForm(updated));
      setNotConfigured(false);
      setSaved(true);
    } catch (err) {
      // Surface validation errors returned by the backend verbatim.
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const hasAnyEntry = useMemo(
    () =>
      LIST_FIELDS.some((f) => formToLines(form[f.key]).length > 0) || form.context.trim() !== '',
    [form]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Knowledge profile</h1>
        <p className="text-sm text-gray-500">
          Tell us what you care about and already know. This is how we decide what deserves your
          attention.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {notConfigured && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
              You haven&apos;t set up your knowledge profile yet. Fill in the fields below and save
              to get started.
            </div>
          )}

          <form onSubmit={onSave} className="space-y-5">
            {LIST_FIELDS.map((field) => (
              <ListField
                key={field.key}
                id={field.key}
                label={field.label}
                hint={field.hint}
                value={form[field.key]}
                onChange={(v) => update(field.key, v)}
              />
            ))}

            <div className="space-y-1">
              <label htmlFor="context" className="block text-sm font-medium text-gray-700">
                Additional context <span className="text-gray-400">(optional)</span>
              </label>
              <p className="text-xs text-gray-500">
                Anything else that helps us understand your goals. Free text.
              </p>
              <textarea
                id="context"
                className="input min-h-24"
                value={form.context}
                onChange={(e) => update('context', e.target.value)}
                placeholder="e.g. I'm transitioning from backend to ML engineering and want to go deep on fundamentals."
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {saved && <p className="text-sm text-green-600">Profile saved.</p>}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : notConfigured ? 'Create profile' : 'Save profile'}
              </button>
              {!hasAnyEntry && (
                <span className="text-xs text-gray-400">
                  Add at least one interest to make recommendations useful.
                </span>
              )}
            </div>
          </form>
        </>
      )}

      <dl className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div className="flex justify-between py-1">
          <dt className="text-gray-500">Email</dt>
          <dd className="text-gray-900">{user?.email}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-gray-500">Role</dt>
          <dd className="text-gray-900">{user?.role}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-gray-500">ID</dt>
          <dd className="font-mono text-xs text-gray-500">{user?.sub}</dd>
        </div>
      </dl>
      <p className="text-xs text-gray-400">Version {__APP_VERSION__}</p>
    </div>
  );
}

interface ListFieldProps {
  id: ListKey;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}

function ListField({ id, label, hint, value, onChange }: ListFieldProps) {
  const count = formToLines(value).length;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        <span className="text-xs text-gray-400">
          {count} {count === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <p className="text-xs text-gray-500">{hint}</p>
      <textarea
        id={id}
        className="input min-h-20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
