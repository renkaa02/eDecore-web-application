# eDecor backend

Real accounts, usage analytics, and an embedded admin dashboard for the
eDecor prototype.

- Visitors can browse the page freely.
- The moment they click a studio control (room type, style, unit toggle,
  file upload, palette, **Generate layout**), a sign-in / sign-up modal
  pops up. After they sign in, their original click replays automatically
  — they don't lose their place.
- Every sign-up and login is recorded. Every "Generate layout" / palette
  pick / room-type pick / style pick / photo upload is recorded too, tied
  to the account that did it.
- The **Admin** link (nav bar or footer) scrolls to a dashboard built
  right into the same page — enter the admin key and see who has an
  account, how many times each person has logged in, a feature-usage
  chart, and how many people used the tool in the last 24h / 7 days.
  Search, sort, and export the user list as CSV from there too.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000** — the studio, the results, and the
admin dashboard (behind the **Admin** link) are all on that one page.

The admin key defaults to `edecor-admin` — change it before you show this
to anyone else:

```bash
ADMIN_KEY=something-only-you-know npm start
```

You can also set a real `JWT_SECRET` the same way:

```bash
JWT_SECRET=a-long-random-string ADMIN_KEY=something-only-you-know npm start
```

## Verify it works

There's a real end-to-end test that spawns the server, loads the actual
`public/index.html` in a DOM, and drives the real sign-up → gated-click →
generate → logout flow — no mocking of the app's own code:

```bash
npm test
```

It should print 14 `PASS` lines. This is the same flow a visitor goes
through by hand; the test just does it automatically so you (or anyone
reviewing the project) can confirm login/signup genuinely works.

## Where the data lives

Everything is stored in `data/db.json` — plain JSON, so you can open it
and read it directly while developing:

- `users` — id, name, email, hashed password (bcrypt, never stored in
  plain text), account-creation time.
- `logins` — one row per sign-up/sign-in: who, when, IP, browser.
- `events` — one row per tracked action (`generate_layout`,
  `select_palette`, `select_room_type`, `select_style`, `upload_photo`),
  tied to a user.

This is a flat-file "database" on purpose, so the project is easy to run
and inspect for a class demo. If this ever needs to hold real users at
scale, swap `readDB()` / `writeDB()` in `server.js` for calls to a real
database (Postgres, MongoDB, etc.) — none of the route logic above them
needs to change.

## API summary

| Method | Path                | Auth           | What it does                          |
|--------|----------------------|----------------|----------------------------------------|
| POST   | `/api/signup`         | —              | Create an account, returns a JWT       |
| POST   | `/api/login`          | —              | Log in, returns a JWT, logs the login  |
| GET    | `/api/me`              | Bearer token   | Current user + their login count       |
| POST   | `/api/track`           | Bearer token   | Log a feature-usage event              |
| GET    | `/api/admin/stats`     | `x-admin-key`  | Everything the admin dashboard shows   |

## What's in the studio now

- **Rooms**: Living/Drawing Room, Bedroom, Kitchen, Washroom, Study /
  Home Office, Yard / Balcony — each with its own furniture-placement
  logic (sofa + TV wall for living rooms, WC + basin + shower for
  washrooms, counter + island for kitchens, and so on).
- **Styles**: Modern, Luxury, Classic, Pure Indian, South Indian, or a
  free-text Customise field — shown as an illustrated "Look & feel"
  motif next to your own uploaded room photo (if you added one), plus a
  short description of what that style leans on.
- **Palette, lighting, and the explainability panel** (space-utilization
  score with signed +/- contributions) all still work the same way.

## Security notes (read before deploying anywhere real)

This is built for a course project, not production traffic:
- Passwords are hashed with bcrypt — good — but `JWT_SECRET` and
  `ADMIN_KEY` default to placeholder values. Always override them with
  environment variables (see above).
- There's no rate limiting on `/api/login` or `/api/signup`. Add one
  (e.g. `express-rate-limit`) before putting this on the open internet.
- Serve over HTTPS in production so tokens and passwords aren't sent in
  the clear.
