Phase 6.5 complete; Phase 7 was not started.

Browser routes are POST /api/v1/auth/web/register, /login, /refresh, and /logout. The existing native routes and token-body contract remain available. Browser login and registration return the short-lived access token and user data, but never the refresh token in JSON. Refresh reads the HttpOnly cookie, uses the existing hashed-token lookup and rotation, and rejects replay. Logout revokes the cookie’s session when present and clears the cookie.

The cookie is signvault_refresh, scoped to /api/v1/auth/web, host-only by default, and expires with the refresh session (Max-Age and Expires). It is always HttpOnly; Secure is enabled in production and whenever SameSite=None is configured. SameSite defaults to Lax. AUTH_COOKIE_SECURE, AUTH_COOKIE_SAME_SITE, and optional AUTH_COOKIE_DOMAIN are documented in .env.example.

CORS allows only the configured FRONTEND_URL and enables credentials. Browser register, login, refresh, and logout require an exact matching Origin; missing, malformed, and unexpected origins are rejected. The README documents the CSRF rationale and reload restoration flow: keep the access token in memory, then call web refresh after reload.

Validation: Build, lint, TypeScript check, Prisma validation, all 21 unit tests, and all 18 e2e tests passed. The browser e2e tests cover cookie attributes, rotation, replay rejection, logout, and Origin checks. Live health returned healthy with the database connected; live CORS preflight returned the configured origin and credentials permission. OpenAPI exposes all four browser routes and the cookie security scheme. No Prisma migration was needed, and no packages were added; cookie-parser and its types were already available.

Files: auth.controller.ts, auth.service.ts, web-session.ts, main.ts, .env.example, README.md, auth.service.spec.ts, and auth-web.e2e-spec.ts.

One deployment consideration remains: configure SameSite=None and Secure only if the frontend and API are genuinely cross-site; use a cookie domain only when deployment requires it. The browser flow does not prevent XSS from acting within an authenticated page.