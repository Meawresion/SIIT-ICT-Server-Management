# SIIT-ICT Resource Management — Frontend

React + Vite + React Router. Talks to the Express backend in `../backend`.

## Run

```bash
npm install
npm run dev
```

The settings come from the root `.env` (template: `../.env.example`); Vite reads only the `VITE_*` keys.

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | Backend base URL (default `http://localhost:3000`; empty = same origin as the page) |
| `VITE_CONTACT_EMAIL` | Helpdesk address shown on Contact Us |

Start the backend first (see `../README.md`). Without it the landing page loads but sign-in fails with a message.

## Screens

| Route | Who | What |
|---|---|---|
| `/` | everyone | Landing page, Google sign-in |
| `/profile` | first login | One-time profile form (the backend redirects here when no profile exists) |
| `/dashboard` | signed in | Forwards to `/home` or `/admin` by role (the backend redirects here after login) |
| `/home` | student | Your Requests + Drafts, New Request / Load Draft, Submitted popup |
| `/admin` | approver | Pending Requests + Active Requests, review popup (Approve / Reject / Mark Active / Mark Completed) |
| `/history` | both | All requests with status tabs, resource filter and search |
| `/account` | both | Profile view and edit |
| `/contact` | both | Contact card, status meanings, FAQ |

## Notes

- **Role.** `/api/auth/me` returns the role from the database; approvers go to `/admin`, everyone else to `/home`.
- **Drafts.** Kept on the server (`/api/drafts`) with the student's account, so they follow the student to another device. Submitting a request from a draft deletes it.
- **Notifications.** There is no notification endpoint. The bell lists decisions on the student's requests (`reviewed_at`), or pending requests for approvers.
- **Usage period.** The form asks for start and end dates without times; a request runs for whole days in the site's time zone (`SITE_TIME_ZONE`).
- **Resource type** can't be changed when editing a pending request: it decides whether the request is set up automatically, so `PATCH /api/requests/:id` refuses a different type.
