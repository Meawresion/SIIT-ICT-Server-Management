# SIIT-ICT Resource Management — Frontend

React + Vite + React Router. Talks to the Express backend in `../backend` and follows the UI mockup.

## Run

```bash
cp .env.example .env
npm install
npm run dev
```

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | Backend base URL (default `http://localhost:3000`) |
| `VITE_CONTACT_EMAIL` | Helpdesk address shown on Contact Us |

Start the backend first (see `../README.md`). Without it the landing page loads but sign-in fails with a message.

### Preview protected pages without Google sign-in

From this directory (the one containing `package.json`), create or edit `.env.local` with:

```env
VITE_MOCK_AUTH=true
VITE_MOCK_AUTH_ROLE=student
```

Restart `npm run dev`, then open the local Vite URL with `/home` appended (for example, `http://localhost:5173/home`). Set `VITE_MOCK_AUTH_ROLE=reviewer` and open `/admin` to preview approver pages. Mock auth is enabled only in Vite development mode and uses placeholder profile data; pages that load request data still need a reachable backend.

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

## Where the frontend works around the current API

- **Role.** `/api/auth/me` returns only ids, so the app treats a user as an approver when `GET /api/reviewer/requests` succeeds.
- **Drafts.** There is no draft endpoint, so drafts are stored in `localStorage` per account. They don't follow the user to another device.
- **Notifications.** There is no notification endpoint. The bell lists decisions on the student's requests (`reviewed_at`), or pending requests for approvers.
- **Usage period.** The backend stores dates only (`DATE`), so the form asks for start and end dates without times.
- **Resource type** can't be changed when editing a pending request, because `PATCH /api/requests/:id` ignores it.
