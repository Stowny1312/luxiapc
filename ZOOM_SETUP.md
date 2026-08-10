# Luxia private Zoom sessions

The website code and Supabase security layer are ready. The live Vercel project needs credentials from two apps created under the Zoom account that owns `tonkata.stoev@gmail.com`.

## 1. Server-to-Server OAuth app

Create and activate a **Server-to-Server OAuth** app in the Zoom App Marketplace. Add the minimum account-level scopes needed to create meetings and obtain the host ZAK token:

- View and manage all user meetings
- View all user information / user ZAK token

Copy its Account ID, Client ID, and Client Secret into these Vercel Preview environment variables:

- `ZOOM_S2S_ACCOUNT_ID`
- `ZOOM_S2S_CLIENT_ID`
- `ZOOM_S2S_CLIENT_SECRET`

## 2. Meeting SDK app

Create and activate a **Meeting SDK** app in the same Zoom account. Add `dev.luxiapc.com` to its approved web domains/allow list.

Copy its Client ID and Client Secret into these Vercel Preview environment variables:

- `ZOOM_MEETING_SDK_CLIENT_ID`
- `ZOOM_MEETING_SDK_CLIENT_SECRET`

Also set:

- `ZOOM_HOST_EMAIL=tonkata.stoev@gmail.com`

All five credential values are server-only. Never put the secrets in browser JavaScript or commit them to Git.

## Runtime behavior

- Owner confirmation creates a scheduled Zoom meeting automatically.
- Meeting numbers and passcodes are stored only in Supabase's private schema.
- The client and owner must be logged into Luxia and authorized for the exact booking.
- Entry opens 10 minutes before `starts_at` and closes at `ends_at`.
- The embedded Zoom client leaves automatically at the booked end time.
- Expired bookings no longer show an active session link in Client Space.
