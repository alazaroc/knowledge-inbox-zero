import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Service worker update UI (registerType: "prompt").
 * Appears only when a new version is available; the user decides when to reload.
 */
export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm rounded-lg bg-indigo-800 p-4 text-white shadow-lg">
      <p className="text-sm">A new version is available.</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => updateServiceWorker(true)}
          className="rounded bg-white px-3 py-1 text-sm font-medium text-indigo-800"
        >
          Update
        </button>
        <button
          onClick={() => setNeedRefresh(false)}
          className="rounded border border-white/30 px-3 py-1 text-sm"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
