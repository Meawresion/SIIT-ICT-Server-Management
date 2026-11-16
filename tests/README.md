# Tests

| Suite | Count | How |
|---|---|---|
| Backend unit tests | 15 (`backend/src/services/services.test.js`) | `cd backend && npm test` |
| Frontend E2E (Playwright) | 16 | see below |
| Deployment verification | 9 | `bash tests/live-check.sh` (read-only, needs the portal running) |
| User acceptance test | 12 | manual, see the Final Report |

## Frontend E2E

```bash
cd frontend
VITE_API_URL= npm run build
npx vite preview --port 4180 --strictPort &

cd ../tests/e2e
npm install
npx playwright install chromium
npm test
```

The API is replaced by `mockapi.mjs`, so no backend or AWS is needed.
Results go to `tests/e2e/out/results.json` and screenshots to `tests/e2e/out/shots/`.
On Windows (PowerShell) build with `$env:VITE_API_URL=""; npm run build`.
To use a Chromium that is already installed, set `CHROMIUM_PATH` to its executable.

## Deployment verification

```bash
bash tests/live-check.sh | tee live-check.log
```

Part A checks the portal from outside. Part B reads AWS state (ECS, alarms, logs, dead-letter queues)
and runs only when `aws sts get-caller-identity --profile des424` works.
