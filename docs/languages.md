# Website languages

English HTML and application messages remain the source of truth. `prototypes/vibrant-premium/nl.js` contains Dutch copy as `English|||Dutch` entries. `i18n.js` translates text and accessible labels without replacing page markup or form values, retaining English originals for switching back. Add parameterized message patterns there, never translating user names, emails, API keys or form values.

The header supports EN and NL; Polish is disabled until translated. The choice persists in `localStorage` (`luxia-language`). `?lang=nl` or `?lang=en` selects a language explicitly. All 20 HTML pages load both scripts. Country labels are translated and sorted without changing calling codes. Dates marked with `data-luxia-date` retain their original English rendering and use `nl-BE` in Dutch.

Browser validation and Luxia's on-page account, contact, payment, calendar and private-session messages are covered. External email templates, Stripe hosted checkout and Zoom's own controls are separate integrations; this change does not alter their settings or financial behavior.

## Verification

With Playwright resolvable (installed in the development environment or via `NODE_PATH`) and Microsoft Edge installed, run `node tests/i18n-smoke.cjs`.

The test intercepts all network requests, serves repository files from a simulated HTTPS origin, and uses simulated accounts and bookings. It never creates real accounts, bookings, payments or emails. It covers 20 pages, language roundtrips and persistence, country names/order, form value preservation, password mismatch, calendar navigation, account and booking statuses, and mobile overflow. Screenshots go to the OS temporary directory, or `LUXIA_TEST_OUTPUT` if supplied.

Deploy language work only from `develop` to Vercel Preview / `dev.luxiapc.com`. Do not promote to production or modify `master`.
