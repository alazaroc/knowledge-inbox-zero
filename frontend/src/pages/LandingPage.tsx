import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Target,
  Gauge,
  UserCog,
  ArrowRight,
  UserPen,
  ClipboardList,
  Sparkles,
  Server,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PageLoader from '../components/ui/PageLoader';
import GithubIcon from '../components/ui/GithubIcon';

const GITHUB_URL = 'https://github.com/alazaroc/knowledge-inbox-zero';

export default function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Already signed in → send straight to the app.
  useEffect(() => {
    if (!loading && user) navigate('/app', { replace: true });
  }, [loading, user, navigate]);

  if (loading) return <PageLoader />;

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2 font-semibold">
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          Knowledge Inbox Zero
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 text-gray-600 hover:text-gray-900 sm:flex"
            aria-label="View source on GitHub"
          >
            <GithubIcon className="h-4 w-4" />
            GitHub
          </a>
          <Link to="/login" className="text-gray-600 hover:text-gray-900">
            Sign in
          </Link>
          <Link
            to="/signup"
            className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main>
        {/* Hero: name the pain first, then the fix. */}
        <section className="mx-auto max-w-3xl px-4 pb-10 pt-12 text-center sm:pt-20">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            You save hundreds of links.
            <br className="hidden sm:block" /> You read almost none of them.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-600">
            Knowledge Inbox Zero scores every link against what you already know and what you
            actually care about, then tells you whether it&apos;s worth reading, skimming, or
            skipping. You read only what adds something — the rest stops weighing on you.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700"
            >
              Get started free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="rounded-lg border border-gray-300 px-5 py-3 font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign in
            </Link>
          </div>
        </section>

        {/* Live demo: a real screenshot of the Library (the capture already
            includes its own browser chrome), so the landing shows the actual
            product — a verdict + reason + MKV per link, most valuable first. */}
        <section className="mx-auto max-w-4xl px-4 pb-16">
          <img
            src="/screenshot-library.png"
            alt="Knowledge Inbox Zero library: your links scored and sorted most valuable first, each with a Worth it / Maybe / Skip verdict, a short reason and an MKV score, plus the attention-saved metric."
            className="w-full rounded-2xl border border-gray-200 shadow-xl shadow-indigo-100/50"
            loading="lazy"
          />
          <p className="mt-3 text-center text-xs text-gray-400">
            Paste a messy pile of links — get a verdict on each.
          </p>
        </section>

        {/* How it works — three plain steps, mirroring the README. */}
        <section className="mx-auto max-w-5xl px-4 pb-4 pt-4">
          <h2 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            How it works
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <Step
              n={1}
              icon={<UserPen className="h-5 w-5 text-indigo-600" />}
              title="Describe what you know"
              body="Set your interests, what you're researching, and what you already master. This is how it decides what's worth your time."
            />
            <Step
              n={2}
              icon={<ClipboardList className="h-5 w-5 text-indigo-600" />}
              title="Paste your links"
              body="Drop in up to 500 URLs — a clean list or a messy dump. They're analyzed in the background; nothing blocks while you keep working."
            />
            <Step
              n={3}
              icon={<Sparkles className="h-5 w-5 text-indigo-600" />}
              title="Read only what counts"
              body="Each link comes back as Worth it, Maybe, or Skip — with a written reason and a score, newest and most valuable first."
            />
          </div>
        </section>

        {/* Problem → solution, with the real "why this recommendation" view. */}
        <section className="border-y border-gray-100 bg-gray-50">
          <div className="mx-auto max-w-5xl px-4 py-14">
            <div className="grid gap-8 sm:grid-cols-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-600">
                  The problem
                </h2>
                <p className="mt-2 text-lg text-gray-700">
                  You pile up articles &ldquo;for later&rdquo; — bookmarks, open tabs, links from
                  everywhere — and almost never open them again. The backlog only grows, and the
                  good stuff is buried in noise.
                </p>
              </div>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
                  The solution
                </h2>
                <p className="mt-2 text-lg text-gray-700">
                  An AI filter built on <em>your</em> profile separates what teaches you something
                  new from what you already know or don&apos;t care about — and explains every
                  verdict in plain words. Never an opaque score.
                </p>
              </div>
            </div>

            <img
              src="/screenshot-document-detail.png"
              alt="A document detail view: the written 'why this recommendation', in your own language, with the recommendation state and quick actions."
              className="mt-10 w-full rounded-2xl border border-gray-200 shadow-xl shadow-indigo-100/50"
              loading="lazy"
            />
            <p className="mt-3 text-center text-xs text-gray-400">
              Every document opens to a written &ldquo;why this recommendation&rdquo; — in your
              profile&apos;s language.
            </p>
          </div>
        </section>

        {/* Features reframed to the benefit, icon beside each one. */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            How it clears the noise
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <Feature
              icon={<Target className="h-6 w-6 text-indigo-600" />}
              title="Scored by what it adds to you"
              body="Not generic popularity — Marginal Knowledge Value weighs each link against what you already know and what you're researching."
            />
            <Feature
              icon={<Gauge className="h-6 w-6 text-indigo-600" />}
              title="Worth it, maybe, or skip"
              body="One clear verdict per link with a short reason, so you decide in seconds instead of hoarding tabs."
            />
            <Feature
              icon={<UserCog className="h-6 w-6 text-indigo-600" />}
              title="Tuned to your profile"
              body="Describe your interests and what you already master once; every score adapts to you from then on."
            />
          </div>
        </section>

        {/* Open source & self-hostable — a selling point for a technical audience. */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-8 sm:p-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white">
                  <Server className="h-3.5 w-3.5" />
                  Open source · MIT
                </div>
                <h2 className="mt-4 text-2xl font-bold tracking-tight text-gray-900">
                  Yours to run, fork, and reshape
                </h2>
                <p className="mt-3 text-gray-600">
                  Fully serverless on AWS and built to be copied. Self-host it on your own account
                  in about 20 minutes — your data stays with you, you tune the limits, and you swap
                  the Bedrock model without touching the core.
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-3">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-3 font-medium text-white hover:bg-gray-800"
                >
                  <GithubIcon className="h-4 w-4" /> View on GitHub
                </a>
                <a
                  href={`${GITHUB_URL}/blob/main/INSTALL.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-5 py-3 font-medium text-gray-700 hover:bg-gray-50"
                >
                  Self-host guide <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* The metric that matters: attention saved, not content stored. */}
        <section className="bg-indigo-600">
          <div className="mx-auto max-w-3xl px-4 py-14 text-center text-white">
            <h2 className="text-2xl font-semibold sm:text-3xl">
              It measures attention saved, not content stored.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-indigo-100">
              Not a bookmark manager. Not a read-it-later app. The one question it answers: what
              deserves your attention right now — and why.
            </p>
            <Link
              to="/signup"
              className="mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 font-medium text-indigo-700 hover:bg-indigo-50"
            >
              Clear your reading backlog <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-gray-400 sm:flex-row">
          <span>Knowledge Inbox Zero — built with Kiro on AWS serverless.</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-gray-900"
          >
            <GithubIcon className="h-4 w-4" /> Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

// A reframed benefit, icon beside the text so each feature reads as a row.
function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-4 rounded-xl border border-gray-200 bg-white p-6">
      <div className="shrink-0">{icon}</div>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600">{body}</p>
      </div>
    </div>
  );
}

// A numbered step for the "How it works" section.
function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-600">
          {n}
        </span>
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm text-gray-600">{body}</p>
    </div>
  );
}
