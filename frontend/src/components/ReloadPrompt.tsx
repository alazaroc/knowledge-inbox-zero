import { useRef } from 'react';
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

  // Guard against a double reload: once we trigger a reload we never trigger a
  // second one (a second reload mid-navigation is what left Brave on a blank
  // page with a module-load error).
  const reloading = useRef(false);

  if (!needRefresh) return null;

  // Apply the waiting SW, then reload ONLY after the new worker has taken
  // control. Forcing window.location.reload() synchronously (the old approach)
  // raced the activation: the page could reload while the old hashed chunks had
  // already been purged by the new precache, so the cached index.html pointed
  // at bundles that no longer existed → blank screen + JS error (seen in Brave
  // behind CloudFront). Reloading on `controllerchange` guarantees the new SW
  // is already serving the new assets before we navigate.
  const applyUpdate = async () => {
    if (reloading.current) return;

    const reloadOnce = () => {
      if (reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };

    // Primary signal: the new SW became the active controller.
    navigator.serviceWorker?.addEventListener('controllerchange', reloadOnce, { once: true });

    try {
      // skipWaiting() on the waiting worker → it activates and claims clients,
      // which fires `controllerchange` above.
      await updateServiceWorker(true);
    } catch {
      // If activation throws, fall through to the timeout backstop below.
    }

    // Backstop: some hosts don't reliably emit `controllerchange` (observed on
    // CloudFront + registerType "prompt"). If it hasn't fired shortly after the
    // update call settles, reload anyway so the user is never stuck on the
    // prompt. The `reloading` guard keeps this from double-firing.
    window.setTimeout(reloadOnce, 1500);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm rounded-lg bg-indigo-800 p-4 text-white shadow-lg">
      <p className="text-sm">A new version is available.</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void applyUpdate()}
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
