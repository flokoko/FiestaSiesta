# 🏖️ Fiesta Siesta

Gemeinsame Urlaubs-App für Gran Canaria (zu dritt).  
Einkaufsliste, Packlisten, Ausgaben mit Splitting, Bristol-Tracking, Notizen & Live-Wetter — alles in einer App mit Realtime-Sync.

**Live:** [flokoko.github.io/FiestaSiesta](https://flokoko.github.io/FiestaSiesta/)

Auf Basis der Bella-Mozzarella-App — gleiches Supabase-Projekt, eigene Liste per Join-Code (`SIESTA26`), Isolation über RLS.

---

## Features

### 🛒 Einkaufsliste
- Items nach Kategorien gruppiert (dynamisch anlegbar)
- Automatische Aggregation: gleiche Items werden zusammengefasst
- Drag & Drop zum Sortieren
- Suchfunktion
- Erledigte ausblenden / Batch-Löschen
- Item-Duplizierung
- Undo beim Löschen (5s Rückgängig)

### 🎒 Mitbringen (+ Packliste)
- Items Personen zuweisen
- Filter: Alle / Nur meine / Unzugewiesen
- Packlisten-Anteil für die Koffer
- Drag & Drop Sortierung

### 💶 Ausgaben
- Ausgaben erfassen mit Betrag, Datum, Kategorie
- Split: Gleichmäßig, Quoten oder exakt
- Automatische Abrechnung (wer schuldet wem)
- Schulden-Matrix + Ausgaben-Charts
- Suchfunktion

### 💩 Bristol-Tracking
- Tägliche Bristol-Skala (1–7 + Plasma 💩)
- Statistik (Ø, Min, Max, Modus)
- Verteilungs-Chart + 14-Tage-Trend
- History mit Inline-Edit
- Confetti-Effekt bei Wert 13

### 📝 Notizen
- Kurznotizen mit Titel + Inhalt
- Favoriten markieren (⭐)
- Drag & Drop Sortierung
- URLs werden automatisch als Links erkannt

### 🌤️ Wetter
- Aktuelles Wetter + 3-Tage-Vorhersage
- Ort frei wählbar, Default: **Maspalomas, Gran Canaria** (Open-Meteo API)
- Einklappbare Vorhersage

### 🎨 UI
- Spanisches Design (Rot `#AA151B`, Gelb `#F1BF00`)
- Glassmorphismus
- Dark Mode (Auto / Hell / Dunkel)
- 3D SiestaScene im Hintergrund (Three.js, Cloud-Balls)
- Haptisches Feedback (Vibration)
- Animierte Kacheln + Seitenübergänge
- PWA: Installierbar, Update-Banner

---

## Tech Stack

| Komponente | Technologie |
|------------|-------------|
| Frontend | React 19 + TypeScript |
| Build | Vite |
| Backend | Supabase (PostgreSQL + Realtime) |
| 3D | Three.js / React Three Fiber |
| Charts | Recharts (Bristol) + CSS-only (Ausgaben) |
| Icons | Lucide React |
| Tests | Vitest + Testing Library |
| Linting | oxlint |
| Hosting | GitHub Pages (via GitHub Actions) |
| Pre-commit | husky + lint-staged |

---

## Setup

```bash
npm install

# .env erstellen (siehe .env.example)
cp .env.example .env
# Dann Werte eintragen:
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key
# VITE_VAPID_PUBLIC_KEY=your-vapid-key
# VITE_OWM_API_KEY=your-owm-key
# VITE_JOIN_CODE=SIESTA26  (optional, Fallback im Code)

npm run dev
```

## Befehle

| Befehl | Beschreibung |
|--------|-------------|
| `npm run dev` | Dev-Server starten |
| `npm run build` | Produktions-Build |
| `npm run test` | Tests ausführen |
| `npm run test:watch` | Tests im Watch-Modus |
| `npm run lint` | Linting (oxlint) |
| `npm run preview` | Build lokal previewen |

## Tests

```bash
npm run test
```

**18 Tests in 3 Dateien:**
- `src/lib/__tests__/aggregate.test.ts` — Item-Aggregation (8 Tests)
- `src/lib/__tests__/settlement.test.ts` — Settlement-Rechnung (10 Tests)
- `src/hooks/__tests__/useOfflineQueue.test.ts` — Offline-Queue (5 Tests)

---

## Supabase Schema

Die App nutzt dasselbe Supabase-Projekt wie Bella Mozzarella; Isolation läuft über die
Join-Code-RLS (`x-join-code` HTTP-Header auf jedem Request). Genutzt werden:

| Tabelle | Beschreibung |
|---------|-------------|
| `lists` | Gruppen (name, join_code, admin_password) |
| `participants` | Teilnehmer (name, password_hash, is_admin) |
| `items` | Einkaufs-/Mitbring-Items (list_type: shopping/bring) |
| `categories` | Dynamische Kategorien (list_type, name, icon, color) |
| `notes` | Kurznotizen (title, content, sort_order, is_favorite) |
| `expenses` | Ausgaben (description, amount, paid_by, split_mode) |
| `expense_splits` | Aufteilung pro Person (person_name, share_amount) |
| `expense_quotas` | Quoten pro Kategorie/Person |
| `bristol_entries` | Bristol-Tracking (entry_date) |
| `push_subscriptions` | Push-Sendeadressen |

### Auth / RPC

- **Login:** Name + Passwort (Join-Code `SIESTA26`)
- **Admin:** Erster Beitreter ist Admin; Quoten-Editor admin-gated
- RPCs: `login_participant`, `change_participant_password`, `restore_participant_session`,
  `verify_admin_password`, `set_admin_password`, `rename_participant`,
  `batch_reorder_items`, `batch_reorder_notes`, `batch_reorder_categories`,
  `batch_delete_items`, `toggle_note_favorite`

---

## Deployment

Push auf `main` → GitHub Actions → `https://flokoko.github.io/FiestaSiesta/`.

**Secrets (einmalig):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_VAPID_PUBLIC_KEY`, `VITE_OWM_API_KEY`.

**Version-Bump-Regel:** Bei jedem Deploy `CACHE_NAME` (public/sw.js) UND `APP_VERSION`
(src/version.ts) GEMEINSAM erhöhen — sonst liefert der Service Worker alte Bundles.

---

## Lizenz

MIT — gemacht mit ☀️ und 🇪🇸