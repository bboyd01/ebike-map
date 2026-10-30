// Login (SPEC §20). Caddy redirects page loads to /login itself; this covers the case where
// the service worker served the cached app shell but the session has expired: the first
// same-origin request that comes back 401 sends you to the login page.
let redirecting = false;

export function installLoginRedirect(): void {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    if (res.status === 401 && !redirecting) {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin) {
        redirecting = true;
        location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      }
    }
    return res;
  };
}

export const signOut = () => location.assign('/logout');
