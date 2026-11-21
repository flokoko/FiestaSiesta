# E2E-Smoke (Playwright)

Läuft nicht in der CI — die Tests brauchen einen Browser-Download (~126 MB) und einen
Preview-Build. Ablauf auf dem Hermes-Host:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/data/cache/pw-browsers npx playwright install chromium   # einmalig
VITE_JOIN_CODE=TESTUI26 npm run build
npx vite preview --port 4173 --host 127.0.0.1 &
PLAYWRIGHT_BROWSERS_PATH=/opt/data/cache/pw-browsers npm run test:e2e
```

Die Tests mocken Supabase auf Netzebene (`page.route`), brauchen also keine Datenbank und
keine echte Liste. `TESTUI26` ist nur der Join-Code im Build, damit der Login-Flow realistisch ist.
