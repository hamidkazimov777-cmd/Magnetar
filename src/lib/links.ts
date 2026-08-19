import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/* ==========================================================================
   Link handling.

   A plain <a href> inside the webview navigates the app window itself: the
   whole IDE is replaced by the target page, with no way back — closing it
   closes Magnetar. Every link must therefore be intercepted.
   ========================================================================== */

/** localhost / loopback — i.e. a dev server the agent just started. */
export function isLocalUrl(href: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(
    href,
  );
}

let previewSeq = 0;

/** Open a link the right way: a local dev server gets its own preview window
 *  (closable without touching the app), anything else goes to the system
 *  browser. Never navigates the main window. */
export async function openLink(href: string): Promise<void> {
  if (isLocalUrl(href)) {
    const label = `preview-${previewSeq++}-${Date.now()}`;
    const w = new WebviewWindow(label, {
      url: href,
      title: href,
      width: 1100,
      height: 800,
      resizable: true,
    });
    w.once("tauri://error", () => {
      // If the window cannot be created, at least do not swallow the click.
      void openUrl(href).catch(() => {});
    });
    return;
  }
  await openUrl(href).catch(() => {});
}

/** Global click interceptor: catches links from markdown, tool output and
 *  anywhere else, so no single component can accidentally hijack the window. */
export function installLinkInterceptor(): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const anchor = (e.target as HTMLElement | null)?.closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    // Only external schemes navigate away; in-app routing uses buttons.
    if (!/^https?:\/\//i.test(href)) return;
    e.preventDefault();
    void openLink(href);
  };

  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
