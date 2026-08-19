/** Copy text to the system clipboard, with a fallback.
 *
 *  `navigator.clipboard.writeText` is not dependable inside a webview: it needs
 *  a secure context and a live user gesture, and when it refuses it rejects
 *  quietly. A caller that swallows that rejection produces the worst possible
 *  outcome — a button that looks like it worked and did nothing. So this tries
 *  the modern API, falls back to a hidden textarea plus `execCommand`, and
 *  returns whether the text actually landed. Callers must show the result. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Keep it off-screen but selectable: display:none would break execCommand.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
