/**
 * Applies the saved theme before first paint.
 *
 * Without this the page renders in the OS theme and then snaps to the user's
 * choice a beat later — a white flash on the way into a dark app, which is
 * exactly the wrong first impression for something meant to be calming.
 *
 * localStorage is the source of truth for *rendering* speed; the profile row is
 * the durable record. Settings writes both.
 */
export function ThemeScript() {
  const script = `
    try {
      var t = localStorage.getItem('lumsa-theme');
      if (t === 'light' || t === 'dark') {
        document.documentElement.setAttribute('data-theme', t);
      }
    } catch (e) {}
  `;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
