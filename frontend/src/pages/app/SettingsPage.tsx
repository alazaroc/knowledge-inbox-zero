import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HelpCircle,
  X,
  FolderGit2,
  ShieldCheck,
  Link2,
  PenLine,
  Sparkles,
  Download,
  AlertTriangle,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';
import type { Profile, ProfileInput } from '@app/shared';
import { MAX_PROFILE_CONTEXT_CHARS } from '@app/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// Source of truth for scoring: either the saved rich text ("Enter directly")
// or a public raw URL the worker fetches at analysis time ("Bring your own").
type SourceMode = 'direct' | 'url';

interface FormState {
  about: string;
  highInterests: string;
  mediumInterests: string;
  currentlyResearching: string;
  activeContexts: string;
  alreadyKnown: string;
  avoidContentTypes: string;
  profileSourceUrl: string;
  profileRepoUrl: string;
  githubToken: string;
  outputLanguage: 'auto' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it';
}

// Shape returned by POST /profile/import (one LLM call → editable draft).
interface DraftProfile {
  highInterests: string[];
  mediumInterests: string[];
  currentlyResearching: string[];
  alreadyKnown: string[];
  activeContexts: string[];
  avoidContentTypes: string[];
  context: string;
}

const EMPTY_FORM: FormState = {
  about: '',
  highInterests: '',
  mediumInterests: '',
  currentlyResearching: '',
  activeContexts: '',
  alreadyKnown: '',
  avoidContentTypes: '',
  profileSourceUrl: '',
  profileRepoUrl: '',
  githubToken: '',
  outputLanguage: 'auto',
};

// A NEUTRAL, generic example profile for new accounts — a full-stack developer
// interested in AI and cloud. Deliberately NOT any specific person's profile,
// so it teaches the expected shape and granularity without biasing scoring
// toward one vendor or domain. Loaded (editable) by "Fill with an example".
const EXAMPLE_FORM: FormState = {
  about:
    'I’m a full-stack developer with a few years of experience, comfortable across ' +
    'frontend and backend. I’m growing into cloud and AI, and I want recommendations ' +
    'that push me forward: new capabilities, patterns and trade-offs I haven’t seen, ' +
    'not introductions to things I already use daily. Skip beginner tutorials and ' +
    'marketing pieces; favour concrete, technical material I can apply at work.',
  highInterests: ['Cloud architecture', 'Applied AI / LLMs', 'Web performance'].join('\n'),
  mediumInterests: ['Databases', 'DevOps and CI/CD', 'Observability'].join('\n'),
  currentlyResearching: ['Retrieval-augmented generation', 'Edge computing'].join('\n'),
  activeContexts: ['Building a side project', 'Migrating a service to the cloud'].join('\n'),
  alreadyKnown: ['REST APIs', 'SQL basics', 'Git workflows'].join('\n'),
  avoidContentTypes: ['Marketing listicles', 'Vendor sales webinars'].join('\n'),
  profileSourceUrl: '',
  profileRepoUrl: '',
  githubToken: '',
  outputLanguage: 'auto',
};

// Profile limits — the About free text is the main signal (prose), so it gets
// a larger budget than a single list line. Surfaced in the UI as live
// "used/limit" counters, and enforced as hard `maxLength` on the inputs.
const MAX_LIST_ENTRIES = 50;
const MAX_ENTRY_CHARS = 200;
// Single source of truth, shared with the backend schema and the import cap —
// what the user can type here is EXACTLY what the store keeps and the scorer
// uses, so nothing is ever silently truncated behind their back.
const MAX_ABOUT_CHARS = MAX_PROFILE_CONTEXT_CHARS;

const toLines = (s: string): string[] =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const fromLines = (arr: string[] | undefined): string => (arr ?? []).join('\n');

function profileToForm(profile: Profile): FormState {
  // When a FILE source is configured, `context` holds the file SNAPSHOT, not a
  // manually-typed About. Don't surface it in the manual About field — the two
  // modes are distinct, and showing the snapshot there is what made switching to
  // "Enter directly" look like it had forced everything into About.
  const usingFileSource = Boolean(profile.profileSourceUrl || profile.profileRepoUrl);
  return {
    about: usingFileSource ? '' : (profile.context ?? ''),
    highInterests: fromLines(profile.highInterests),
    mediumInterests: fromLines(profile.mediumInterests),
    currentlyResearching: fromLines(profile.currentlyResearching),
    activeContexts: fromLines(profile.activeContexts),
    alreadyKnown: fromLines(profile.alreadyKnown),
    avoidContentTypes: fromLines(profile.avoidContentTypes),
    profileSourceUrl: profile.profileSourceUrl ?? '',
    profileRepoUrl: profile.profileRepoUrl ?? '',
    githubToken: '', // write-only — never prefilled from the server
    outputLanguage: profile.outputLanguage ?? 'auto',
  };
}

function formToPayload(
  form: FormState,
  mode: SourceMode,
  visibility: 'public' | 'private',
  tokenAction: 'set' | 'clear' | 'leave'
): ProfileInput {
  return {
    highInterests: toLines(form.highInterests),
    mediumInterests: toLines(form.mediumInterests),
    currentlyResearching: toLines(form.currentlyResearching),
    activeContexts: toLines(form.activeContexts),
    alreadyKnown: toLines(form.alreadyKnown),
    avoidContentTypes: toLines(form.avoidContentTypes),
    context: form.about.trim() ? form.about.trim() : undefined,
    // Send ONLY the field for the active visibility; empty the other so the two
    // never both carry a value (that ambiguity is what made the loader show the
    // wrong one). public → source URL, private → repo URL.
    profileSourceUrl: mode === 'url' && visibility === 'public' ? form.profileSourceUrl.trim() : '',
    profileRepoUrl: mode === 'url' && visibility === 'private' ? form.profileRepoUrl.trim() : '',
    outputLanguage: form.outputLanguage,
    // Token: 'set' sends the typed value, 'clear' sends '' to delete it,
    // 'leave' omits it so an existing stored token is untouched.
    githubToken:
      tokenAction === 'set' ? form.githubToken.trim() : tokenAction === 'clear' ? '' : undefined,
  };
}

export default function SettingsPage() {
  useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<SourceMode>('direct');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // #3: true only right after a genuine first-time save (onboarding). Drives
  // the "go to your library" affordance in the success banner, without an
  // automatic redirect.
  const [justOnboarded, setJustOnboarded] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // #4: set when the form was just filled from an import, so we can show the
  // "this is an editable draft, review and Save" banner. Cleared on save.
  const [isDraft, setIsDraft] = useState(false);
  // "Bring your own" live sync: result of the last "Test & save from file".
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<
    | { ok: true; text: string; chars: number; originalChars?: number; truncated?: boolean }
    | { ok: false; message: string }
    | null
  >(null);
  // Whether a private-repo token is already stored (server flag, value never sent).
  const [hasToken, setHasToken] = useState(false);
  // User pressed "Remove token": send an explicit clear on next save.
  const [clearToken, setClearToken] = useState(false);
  // #3 (url mode): which single file field to show — public or private.
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  // #7: the file snapshot persisted in the DB (profile.context when a file
  // source is configured). Lets the user RE-READ what the AI stored even after
  // leaving the page, without re-syncing — and copy it into the editable About.
  const [savedSnapshot, setSavedSnapshot] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const profile = await api.get<Profile>('/profile');
      setForm(profileToForm(profile));
      setMode(profile.profileSourceUrl || profile.profileRepoUrl ? 'url' : 'direct');
      setNotConfigured(Boolean(profile.notConfigured));
      setHasToken(Boolean(profile.hasToken));
      // Show the source the user actually CONFIGURED — the field that has a
      // value. (Saving now sends only one of the two, so they're never both set;
      // for any legacy row that has both, private wins as the more deliberate
      // setup.) A stored token alone does not decide this.
      setVisibility(profile.profileRepoUrl ? 'private' : 'public');
      // #7: keep the stored snapshot so the url-mode block can show it later.
      const usingFile = Boolean(profile.profileSourceUrl || profile.profileRepoUrl);
      setSavedSnapshot(usingFile ? (profile.context ?? '') : '');
      setClearToken(false);
      setIsDraft(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const touched = () => {
    setSaved(false);
    setJustOnboarded(false);
  };

  // "Fill with an example": load the neutral example into the form (direct
  // mode) so a new user sees the expected shape and can edit or clear it. It
  // does NOT save — the user still reviews and presses "Create profile".
  const fillWithExample = () => {
    setForm(EXAMPLE_FORM);
    setMode('direct');
    touched();
  };

  // Whether the knowledge profile is effectively empty (nothing typed in any
  // field). Used to offer the example on an empty profile, not just first login.
  // A "bring your own" source (public URL or private repo) counts as configured
  // — never show the "empty, start from an example" nudge in that case.
  const isEmpty = (f: FormState): boolean =>
    !f.about.trim() &&
    !toLines(f.highInterests).length &&
    !toLines(f.mediumInterests).length &&
    !toLines(f.currentlyResearching).length &&
    !toLines(f.activeContexts).length &&
    !toLines(f.alreadyKnown).length &&
    !toLines(f.avoidContentTypes).length &&
    !f.profileSourceUrl.trim() &&
    !f.profileRepoUrl.trim() &&
    !hasToken;

  // Prefill the form from an imported DRAFT (from "Import from URL"). The draft
  // is NEVER saved automatically — it lands in the editable form for review.
  const applyDraft = (draft: DraftProfile) => {
    setForm((prev) => ({
      about: draft.context ?? '',
      highInterests: fromLines(draft.highInterests),
      mediumInterests: fromLines(draft.mediumInterests),
      currentlyResearching: fromLines(draft.currentlyResearching),
      activeContexts: fromLines(draft.activeContexts),
      alreadyKnown: fromLines(draft.alreadyKnown),
      avoidContentTypes: fromLines(draft.avoidContentTypes),
      profileSourceUrl: '',
      profileRepoUrl: '',
      githubToken: '',
      outputLanguage: prev.outputLanguage,
    }));
    setMode('direct');
    setShowImport(false);
    setIsDraft(true);
    touched();
  };

  const set =
    (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>) => {
      const { value } = e.target;
      setForm((prev) => ({ ...prev, [key]: value }));
      touched();
    };

  // "Bring your own": fetch the configured file LIVE, show what was read, and
  // store it as the profile snapshot. This is how the user confirms the source
  // works (token valid, file reachable) BEFORE relying on the app.
  const onSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError('');
    try {
      const res = await api.post<{
        profile: Profile;
        preview: { text: string; chars: number; originalChars?: number; truncated?: boolean };
      }>('/profile/sync', {
        profileSourceUrl: form.profileSourceUrl.trim(),
        profileRepoUrl: form.profileRepoUrl.trim(),
        ...(form.githubToken.trim() ? { githubToken: form.githubToken.trim() } : {}),
      });
      setForm(profileToForm(res.profile));
      setHasToken(Boolean(res.profile.hasToken));
      setSyncResult({
        ok: true,
        text: res.preview.text,
        chars: res.preview.chars,
        originalChars: res.preview.originalChars,
        truncated: res.preview.truncated,
      });
      setSaved(false);
      setIsDraft(false);
    } catch (err) {
      setSyncResult({ ok: false, message: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    const wasFirstSave = notConfigured;
    // Decide what to do with the token: clear if the user asked to remove it,
    // set if they typed a new one, otherwise leave any stored token untouched.
    const tokenAction: 'set' | 'clear' | 'leave' = clearToken
      ? 'clear'
      : form.githubToken.trim()
        ? 'set'
        : 'leave';
    try {
      const updated = await api.put<Profile>(
        '/profile',
        formToPayload(form, mode, visibility, tokenAction)
      );
      setForm(profileToForm(updated));
      setMode(updated.profileSourceUrl || updated.profileRepoUrl ? 'url' : 'direct');
      setNotConfigured(false);
      setHasToken(Boolean(updated.hasToken));
      setClearToken(false);
      setIsDraft(false);
      setSaved(true);
      setJustOnboarded(wasFirstSave);
      // #3: never auto-redirect away from Settings on save. The user stays on
      // the Knowledge profile page and sees a prominent "Profile saved" banner.
      // On genuine first-time onboarding we additionally surface a clear
      // "go to your library" affordance (see the success banner) rather than
      // yanking them away without confirmation.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Knowledge profile</h1>
          <p className="text-sm text-gray-500">
            Your knowledge profile and data sources. This is how we decide what deserves your
            attention.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <HelpCircle className="h-4 w-4" /> How does this work?
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {notConfigured && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
              <p>
                Welcome! Set up your profile to unlock your library. Write a few lines about
                yourself and what matters to you, then save.
              </p>
              <button
                type="button"
                onClick={fillWithExample}
                className="mt-3 inline-flex items-center gap-1.5 rounded border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
              >
                <Sparkles className="h-4 w-4" /> Fill with an example
              </button>
            </div>
          )}

          {/* Empty profile that is NOT first-login: still offer the example. */}
          {!notConfigured && isEmpty(form) && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              <span>Your profile is empty. Start from a neutral example and edit it.</span>
              <button
                type="button"
                onClick={fillWithExample}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                <Sparkles className="h-4 w-4" /> Fill with an example
              </button>
            </div>
          )}

          {/* #4: an imported draft is editable and NOT yet saved — make that explicit. */}
          {isDraft && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  This is a <strong>draft</strong> generated from your import. Review the fields
                  below, edit anything, then press <strong>Save</strong> to keep it.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsDraft(false)}
                className="rounded p-1 text-amber-500 hover:bg-amber-100 hover:text-amber-700"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ONE picker, two mutually-exclusive ways to provide the profile.
              Everything that belongs to each mode lives INSIDE this section,
              so the import box and the file-config block are never both shown. */}
          <SourceSection defaultOpen={notConfigured}>
            <SourceToggle
              mode={mode}
              onChange={(m) => {
                setMode(m);
                touched();
              }}
            />

            {/* Import/paste is a HELPER for "Enter directly" — it fills the
                fields below with an editable draft. Only shown in direct mode. */}
            {mode === 'direct' && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 p-3">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Download className="h-4 w-4 text-indigo-600" />
                  <span>
                    Have a bio, CV or “about me” text? <strong>Paste it</strong> and we’ll generate
                    a draft you can edit below.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImport(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  Paste text
                </button>
              </div>
            )}

            {/* "Bring your own" file config — only shown in url mode. */}
            {mode === 'url' && (
              <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Point us at one profile file
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Give the link to a <strong>single text or Markdown file</strong> in your repo
                    (for example <code>profile.md</code>, in any folder). Paste the normal GitHub
                    link — <code>https://github.com/you/your-repo/blob/main/profile.md</code> — and
                    we convert it to the raw file for you. We read that one file; we don’t crawl
                    other files or folders.
                  </p>
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                    <strong>This file becomes your whole profile.</strong> We read its text and use{' '}
                    <strong>only that</strong> for scoring — the manual fields above (interests,
                    already-known, etc.) are <strong>not</strong> used while a file is set. So put
                    everything that matters in the file itself.
                  </p>
                </div>

                {/* #3: pick public OR private — only the chosen field renders. */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">
                    Is your file public or private?
                  </p>
                  <div className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setVisibility('public');
                        setForm((prev) => ({ ...prev, profileRepoUrl: '' }));
                        touched();
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        visibility === 'public'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Public — no token
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVisibility('private');
                        setForm((prev) => ({ ...prev, profileSourceUrl: '' }));
                        touched();
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        visibility === 'private'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Private — needs a token
                    </button>
                  </div>
                </div>

                {visibility === 'public' ? (
                  /* Public file */
                  <div className="space-y-1">
                    <label htmlFor="sourceUrl" className="block text-sm font-medium text-gray-800">
                      Public file link
                    </label>
                    <p className="text-xs text-gray-500">
                      Anyone can open this file without logging in — no token needed.
                    </p>
                    <input
                      id="sourceUrl"
                      type="url"
                      className="input mt-1 w-full font-mono text-sm"
                      value={form.profileSourceUrl}
                      onChange={set('profileSourceUrl')}
                      placeholder="https://github.com/you/your-repo/blob/main/profile.md"
                    />
                  </div>
                ) : (
                  /* Private repo: URL + token stored in AWS Secrets Manager. */
                  <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      Private file link
                      {hasToken && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          <ShieldCheck className="h-3 w-3" /> Token saved
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      The file is in a <strong>private</strong> repo — paste its link and add a
                      fine-grained, read-only token.
                    </p>
                    <input
                      type="url"
                      className="input mt-1 w-full font-mono text-sm"
                      value={form.profileRepoUrl}
                      onChange={set('profileRepoUrl')}
                      placeholder="https://github.com/you/your-repo/blob/main/profile.md"
                    />
                    {hasToken && !clearToken ? (
                      <div className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 text-gray-600">
                          <span className="font-mono tracking-widest text-gray-400">••••••••</span>
                          Token saved — you don’t need to enter it again.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setClearToken(true);
                            touched();
                          }}
                          className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                        >
                          Remove token
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          type="password"
                          autoComplete="off"
                          className="input w-full font-mono text-sm"
                          value={form.githubToken}
                          onChange={set('githubToken')}
                          placeholder="github_pat_..."
                        />
                        {clearToken && (
                          <button
                            type="button"
                            onClick={() => {
                              setClearToken(false);
                              touched();
                            }}
                            className="text-xs font-medium text-gray-500 hover:underline"
                          >
                            Keep the saved token instead
                          </button>
                        )}
                      </>
                    )}
                    <p className="text-xs text-gray-400">
                      Create it at GitHub → Settings → Developer settings → Fine-grained tokens,
                      scoped to <strong>one repository</strong> with{' '}
                      <strong>Contents: Read-only</strong>. It’s stored encrypted and never shown
                      again.
                    </p>
                  </div>
                )}

                {/* Test & save: the heart of "Bring your own" — read the file now,
                    show what we got, store it as the snapshot used for scoring. */}
                <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-gray-700">
                      Read the file now to check it works and see exactly what we extracted. We save
                      that text as your profile — press this again any time you update your file.
                    </p>
                    <button
                      type="button"
                      onClick={onSync}
                      disabled={syncing}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      <Download className="h-4 w-4" />
                      {syncing ? 'Reading…' : 'Test & save from file'}
                    </button>
                  </div>

                  {syncResult?.ok === false && (
                    <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      <span>{syncResult.message}</span>
                    </div>
                  )}

                  {syncResult?.ok === true && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                        <ShieldCheck className="h-4 w-4" />
                        Read and saved — {syncResult.chars.toLocaleString()} characters. This is
                        what we’ll use:
                      </div>
                      {syncResult.truncated && (
                        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <span>
                            Your file is {syncResult.originalChars?.toLocaleString()} characters —
                            we stored the first {syncResult.chars.toLocaleString()} (the limit).
                            Shorten it to the essentials if the end matters.
                          </span>
                        </div>
                      )}
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-3 text-xs text-gray-700">
                        {syncResult.text}
                      </pre>
                      <p className="text-xs text-gray-500">
                        Not what you expected? Edit your file and press{' '}
                        <strong>Test &amp; save from file</strong> again.
                      </p>
                    </div>
                  )}

                  {/* #7: when there is NO fresh sync this session but a snapshot is
                      already stored, show it so the user can RE-READ what the AI
                      uses — and copy it into the editable About to tweak by hand. */}
                </div>
              </section>
            )}
          </SourceSection>

          {/* #4: the stored file snapshot, shown OUTSIDE the collapsed accordion
              — same placement as the About textarea in "Enter directly" — so the
              user can always SEE what the AI uses and jump to editing it. Only in
              file mode, and only when there is a stored snapshot to show. */}
          {mode === 'url' && !syncResult && savedSnapshot.trim() && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Currently stored — {savedSnapshot.length.toLocaleString()} characters. This is what
                we use:
              </div>
              <textarea
                readOnly
                value={savedSnapshot}
                rows={10}
                className="input w-full resize-y bg-gray-50 text-sm text-gray-700"
              />
              <button
                type="button"
                onClick={() => {
                  // Copy the snapshot into the editable About and switch to manual
                  // mode so the user can edit it directly. Saving in manual mode
                  // clears the file source (formToPayload).
                  setForm((prev) => ({ ...prev, about: savedSnapshot }));
                  setMode('direct');
                  touched();
                }}
                className="inline-flex items-center gap-1.5 rounded border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Edit this as my profile text
              </button>
              <p className="text-xs text-gray-500">
                Editing switches you to “Enter directly” and detaches the file, so your edits stick.
              </p>
            </div>
          )}

          <form onSubmit={onSave} className="space-y-6">
            {/* Language the AI writes its explanations in — a global profile
                preference, shown in both modes. 'Auto' matches your profile's
                own language so cards stop coming back in a mix of languages. */}
            <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-4">
              <label htmlFor="outputLanguage" className="block text-sm font-semibold text-gray-800">
                Language for AI recommendations
              </label>
              <p className="text-xs text-gray-500">
                The language we write each recommendation’s explanation in. “Auto” follows your
                profile’s own language.
              </p>
              <select
                id="outputLanguage"
                className="input mt-1 w-full sm:w-auto"
                value={form.outputLanguage}
                onChange={set('outputLanguage')}
              >
                <option value="auto">Auto (match my profile)</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="pt">Português</option>
                <option value="it">Italiano</option>
              </select>
            </div>

            {/* In "Bring your own" mode we don't show the seven text boxes —
                the file IS the profile. A short note keeps it unambiguous. */}
            {mode === 'url' && (
              <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span>
                  Your profile comes from the file above. To change it, edit your file and press{' '}
                  <strong>Test &amp; save from file</strong>, or switch to{' '}
                  <strong>Enter directly</strong> to type it here instead.
                </span>
              </div>
            )}

            {mode === 'direct' && (
              <div>
                <Field
                  id="about"
                  label="About you — the main signal"
                  primary
                  hint={
                    'Tell us your background, your level, how you work, and how you want ' +
                    'recommendations judged, in full sentences. Don’t repeat your interest lists ' +
                    'above; this is your context and criteria. You can write this in your own ' +
                    'language, it works just as well.'
                  }
                  value={form.about}
                  onChange={set('about')}
                  rows={6}
                  counter="chars"
                  maxLength={MAX_ABOUT_CHARS}
                  placeholder={
                    'e.g. I’m a senior cloud architect focused on AWS, serverless and platform engineering. ' +
                    'I want the small fraction of content that materially improves my work. ' +
                    'Skip fundamentals I already know; prioritize new capabilities, patterns, trade-offs and benchmarks.'
                  }
                />

                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  <Field
                    id="high"
                    label="High interests"
                    hint="One per line."
                    value={form.highInterests}
                    onChange={set('highInterests')}
                    counter="list"
                  />
                  <Field
                    id="known"
                    label="Already known"
                    hint="Don’t re-explain fundamentals of these. One per line."
                    value={form.alreadyKnown}
                    onChange={set('alreadyKnown')}
                    counter="list"
                  />
                </div>

                {/* #6: the remaining fields still feed scoring, but most users
                  don't need them day one — tuck them behind a collapsible.
                  Open by default during onboarding, closed once configured. */}
                <OptionalDetail defaultOpen={notConfigured}>
                  <div className="grid gap-6 md:grid-cols-2">
                    <Field
                      id="medium"
                      label="Medium interests"
                      hint="One per line."
                      value={form.mediumInterests}
                      onChange={set('mediumInterests')}
                      counter="list"
                    />
                    <Field
                      id="researching"
                      label="Currently researching"
                      hint="What you are actively investigating now. One per line."
                      value={form.currentlyResearching}
                      onChange={set('currentlyResearching')}
                      counter="list"
                    />
                    <Field
                      id="contexts"
                      label="Current projects / work"
                      hint="What you are actively building or driving right now (distinct from research). One per line."
                      value={form.activeContexts}
                      onChange={set('activeContexts')}
                      counter="list"
                    />
                    <Field
                      id="avoid"
                      label="Avoid content types"
                      hint="Kinds of content you’d rather not see. One per line."
                      value={form.avoidContentTypes}
                      onChange={set('avoidContentTypes')}
                      counter="list"
                    />
                  </div>
                </OptionalDetail>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {saved && (
              <div className="flex flex-col gap-3 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                  {justOnboarded
                    ? 'Profile saved — your library is ready.'
                    : 'Profile saved. Your changes are live.'}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/app/library')}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Go to your library <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving
                  ? 'Saving…'
                  : notConfigured
                    ? 'Create profile'
                    : mode === 'url'
                      ? 'Save source settings'
                      : 'Save profile'}
              </button>
            </div>
          </form>
        </>
      )}

      {showHelp && <HowItWorksModal onClose={() => setShowHelp(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onDraft={applyDraft} />}
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint: string | React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  primary?: boolean;
  placeholder?: string;
  // Live usage counter under the field. 'list' counts non-empty lines against
  // MAX_LIST_ENTRIES; 'chars' counts characters against MAX_ABOUT_CHARS.
  counter?: 'list' | 'chars';
  // Hard character cap on the textarea (About field).
  maxLength?: number;
}

// "Near the limit" threshold: turn the counter red at ≥90% of the cap.
const NEAR_LIMIT_RATIO = 0.9;
// Effective character budget for a list field: at most MAX_LIST_ENTRIES lines
// of MAX_ENTRY_CHARS each. Expressed as a single char budget so EVERY field
// shows the same "used/limit characters" measure (consistency, per user).
const MAX_LIST_CHARS = MAX_LIST_ENTRIES * MAX_ENTRY_CHARS;

function UsageCounter({ counter, value }: { counter: 'list' | 'chars'; value: string }) {
  if (counter === 'chars') {
    const used = value.length;
    const near = used >= MAX_ABOUT_CHARS * NEAR_LIMIT_RATIO;
    const over = used > MAX_ABOUT_CHARS;
    return (
      <p className={`mt-1 text-right text-xs ${over || near ? 'text-red-600' : 'text-gray-400'}`}>
        {used.toLocaleString()}/{MAX_ABOUT_CHARS.toLocaleString()} characters
      </p>
    );
  }
  const entries = value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const used = entries.length;
  const totalChars = value.length;
  const longEntries = entries.filter((e) => e.length > MAX_ENTRY_CHARS).length;
  const overEntries = used > MAX_LIST_ENTRIES;
  const overChars = totalChars > MAX_LIST_CHARS;
  const near = totalChars >= MAX_LIST_CHARS * NEAR_LIMIT_RATIO;
  const alert = overEntries || longEntries > 0 || overChars || near;
  return (
    <p className={`mt-1 text-right text-xs ${alert ? 'text-red-600' : 'text-gray-400'}`}>
      {totalChars.toLocaleString()}/{MAX_LIST_CHARS.toLocaleString()} characters
      {longEntries > 0 && (
        <span className="text-red-600">
          {' '}
          · {longEntries} line{longEntries > 1 ? 's' : ''} over {MAX_ENTRY_CHARS} chars
        </span>
      )}
      {overEntries && (
        <span className="text-red-600">
          {' '}
          · too many lines ({used}/{MAX_LIST_ENTRIES})
        </span>
      )}
    </p>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  rows = 4,
  primary,
  placeholder,
  counter,
  maxLength,
}: FieldProps) {
  return (
    <section
      className={
        primary ? 'space-y-1 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4' : 'space-y-1'
      }
    >
      <label htmlFor={id} className="block text-sm font-semibold text-gray-800">
        {label}
      </label>
      <p className="text-xs text-gray-500">{hint}</p>
      <textarea
        id={id}
        className="input mt-1 min-h-24 w-full"
        rows={rows}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
      />
      {counter && <UsageCounter counter={counter} value={value} />}
    </section>
  );
}

// Collapsible wrapper around the data-source picker. Once a profile is set up,
// the source rarely changes — so it starts collapsed to a one-line summary and
// the profile fields take center stage. During onboarding (or when a URL source
// is in use) it starts open so the choice is front and center.
function SourceSection({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="truncate">
            Profile source &amp; import
            <span className="ml-1 font-normal text-gray-400">— advanced</span>
          </span>
        </span>
        {!open && (
          <span className="hidden shrink-0 text-xs font-normal text-gray-400 sm:inline">
            Change how your profile is provided
          </span>
        )}
      </button>
      {open && <div className="space-y-3 border-t border-gray-100 p-4">{children}</div>}
    </div>
  );
}

// #6: Collapsible wrapper for the optional, finer-grained profile fields. Same
// chevron/disclosure pattern as SourceSection. The three essential fields (About,
// High interests, Already known) stay always visible; these ride behind the
// disclosure so first-time users aren't faced with seven boxes. All fields still
// feed scoring regardless of whether this is open.
function OptionalDetail({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <ChevronRight
            className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          More detail
          <span className="font-normal text-gray-400">— optional</span>
        </span>
        {!open && (
          <span className="text-xs font-normal text-gray-400">
            Medium interests, research, contexts, content to avoid
          </span>
        )}
      </button>
      {open && <div className="space-y-3 border-t border-gray-100 p-4">{children}</div>}
    </div>
  );
}

function SourceToggle({ mode, onChange }: { mode: SourceMode; onChange: (m: SourceMode) => void }) {
  const Btn = ({
    m,
    icon,
    title,
    desc,
  }: {
    m: SourceMode;
    icon: React.ReactNode;
    title: string;
    desc: string;
  }) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      className={`flex-1 rounded-lg border p-3 text-left transition ${
        mode === m
          ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
          : 'border-gray-300 bg-white hover:bg-gray-50'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-xs text-gray-500">{desc}</span>
    </button>
  );
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-700">
        How do you want to provide your profile?{' '}
        <span className="font-normal text-gray-500">Pick one — they’re alternatives.</span>
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Btn
          m="direct"
          icon={<PenLine className="h-4 w-4 text-indigo-600" />}
          title="Enter directly"
          desc="Type your profile in the fields below (or import/paste a draft to start). Stored securely with your account."
        />
        <Btn
          m="url"
          icon={<Link2 className="h-4 w-4 text-indigo-600" />}
          title="Bring your own file"
          desc="Point us at one profile file in a repo — public, or private with a read-only token."
        />
      </div>
    </div>
  );
}

function HowItWorksModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-[max(1rem,env(safe-area-inset-top))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-2xl overflow-x-hidden break-words rounded-xl bg-white p-6 shadow-xl [overflow-wrap:anywhere]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="help-title" className="text-lg font-semibold text-gray-900">
            How your profile works
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-3 text-sm text-gray-600">
          We score each document by reading your whole profile and judging — semantically, not by
          keyword matching — whether it brings something new and relevant to <em>you</em>. There are
          two ways to give us that profile.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <PenLine className="h-4 w-4 text-indigo-600" /> Enter directly
            </h3>
            <p className="mt-1 text-xs font-medium text-gray-500">Pros</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-600">
              <li>Nothing to set up — just type and save.</li>
              <li>Edit any time from this page.</li>
            </ul>
            <p className="mt-2 text-xs font-medium text-gray-500">Cons</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-600">
              <li>Your profile text is stored in this app.</li>
              <li>You maintain it here, separate from your own notes.</li>
            </ul>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Link2 className="h-4 w-4 text-indigo-600" /> Bring your own
            </h3>
            <p className="mt-1 text-xs font-medium text-gray-500">Pros</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-600">
              <li>You keep the source of truth in your own repo.</li>
              <li>Press “Test &amp; save from file” to read it and see exactly what we got.</li>
              <li>Updated your file? Press it again to pull the new version.</li>
            </ul>
            <p className="mt-2 text-xs font-medium text-gray-500">Cons</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-600">
              <li>It points at one file (not a whole folder of notes).</li>
              <li>A private file needs a read-only token.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <FolderGit2 className="h-4 w-4" /> Point us at one file in your repo
          </h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
            <li>
              In any Git repo of yours, keep one text/Markdown file describing your interests and
              background, e.g. <code>profile.md</code> (it can live in any folder).
            </li>
            <li>
              Open that file on GitHub and copy the link from your browser, e.g.{' '}
              <code>https://github.com/you/your-repo/blob/main/profile.md</code> — we turn it into
              the raw file automatically.
            </li>
            <li>
              Paste it under “Bring your own”. Pick <strong>Public</strong> or{' '}
              <strong>Private</strong>; a private file also needs a read-only token. Then press{' '}
              <strong>Test &amp; save from file</strong> to read it and confirm what we extracted —
              we store that snapshot, so a later edit means pressing it again.
            </li>
          </ol>
        </div>

        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <ShieldCheck className="h-4 w-4" /> Private repo? Read-only access only
          </h3>
          <p className="mt-1 text-sm text-emerald-900">
            A private file is read with a token you paste and can revoke at any time. The safe way
            to grant it is a GitHub <strong>fine-grained personal access token</strong> scoped to{' '}
            <strong>a single repository</strong> with <strong>Contents: Read-only</strong> and
            nothing else — never a classic token or broad scopes.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-emerald-900">
            <li>
              GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
            </li>
            <li>
              Resource owner: you. Repository access: “Only select repositories” → the repo that
              holds your profile file.
            </li>
            <li>
              Permissions → Repository permissions → <strong>Contents: Read-only</strong>. Leave
              everything else as No access.
            </li>
            <li>Set a short expiration and keep the token secret.</li>
          </ol>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// Import a profile from a public URL OR pasted text. Calls POST /profile/import,
// which fetches/reads the text and asks the model for a DRAFT profile; the draft
// is handed back via onDraft to prefill the editable form (never saved blind).
function ImportModal({
  onClose,
  onDraft,
}: {
  onClose: () => void;
  onDraft: (draft: DraftProfile) => void;
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setError('');
    const trimmed = text.trim();
    if (!trimmed) return setError('Paste some text.');
    setLoading(true);
    try {
      const res = await api.post<{ draft: DraftProfile }>('/profile/import', { text: trimmed });
      onDraft(res.draft);
    } catch (err) {
      setError((err as Error).message || 'Could not generate a draft. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="import-title" className="text-lg font-semibold text-gray-900">
            Paste your profile text
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          Paste a bio, CV, or any “about me” text, and we’ll turn it into a <strong>draft</strong>{' '}
          profile you can edit. Nothing is saved until you review it and press Save.{' '}
          <span className="text-gray-500">
            (Have your profile in a repo instead? Use <strong>Bring your own file</strong>.)
          </span>
        </p>

        <div className="mt-4">
          <textarea
            className="input min-h-40 w-full"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a bio, CV, or any text about yourself…"
            autoFocus
          />
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Generating draft…' : 'Generate draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
