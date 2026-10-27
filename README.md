# TripSplit — Smart Group Trip Expense & Settlement Tracker

[![Live Demo](https://img.shields.io/badge/Live%20Demo-tripsplit--9ju.pages.dev-success?style=for-the-badge&logo=cloudflarepages)](https://tripsplit-9ju.pages.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-Node%20Test%20%7C%20Playwright-brightgreen?style=for-the-badge)](tests/)

**TripSplit** is a lightweight, privacy-focused, offline-first web application designed to eliminate the friction of splitting expenses during group trips. It runs smoothly in modern browsers, features zero runtime dependencies, provides automated background cloud sync backed by Cloudflare D1, and automatically computes the optimal minimum transactions needed to settle all debts.

> 🚀 **Live Web App**: [https://tripsplit-9ju.pages.dev/](https://tripsplit-9ju.pages.dev/)

---

## ✨ Key Features

### 🏖️ Group Trip Management
- **Multiple Trips**: Manage separate trips (e.g., *"Goa Weekend Getaway"*, *"Manali Trek"*) independently.
- **Dynamic Member Management**: Add and organize trip participants with ease.
- **Identity Spotlight ("I am [Name]")**: Choose your profile to instantly highlight your personal balance (*"You are owed ₹X"* or *"You owe ₹Y"*).
- **Pre-loaded Demo Trip**: Comes with a realistic Goa trip pre-loaded so you can explore the app immediately.

### 💸 Flexible Expense Tracking
- **Category Tagging**: Organize expenses by *Food & Drinks*, *Stay & Hotel*, *Travel & Fuel*, *Activities*, *Shopping*, and *Other*.
- **Three Split Modes**:
  - **Equal Split**: Evenly divides expenses among all or selected members with remainder paise distribution.
  - **Custom Split (₹)**: Assign exact amounts to specific members with real-time total matching validation.
  - **Percentage Split (%)**: Split expenses based on custom percentages with dynamic rounding balance.
- **Payer Designation**: Supports expenses paid by any group member with date tracking.
- **Subunit Precision (Paise)**: All calculations run on integer subunits (`amountPaise`) to eliminate floating-point rounding errors (`₹0.01` accuracy).

### ⚖️ Debt Minimization & Settle-Up Checklist
- **Optimized Settlement Plan**: Uses a greedy cash-flow minimization algorithm to reduce complicated group debts into the fewest possible payments.
- **Interactive Checklist**: Mark individual settlement recommendations as completed as friends pay up.
- **Live Progress Bar**: Visual progress indicator (`X / Y Settled`) that automatically updates net balances as payments are recorded.
- **Net Balances View**: Transparent breakdown of total spent, total share, and current net standing for every member.

### ☁️ Hybrid Cloud Sync & Offline-First Architecture (Phase C)
- **Automatic Cloudflare D1 Background Sync**: Automatically and silently syncs trip updates to a Cloudflare D1 serverless SQLite database via debounced background requests.
- **Real-Time Status Indicator**: Header sync indicator keeps you informed with live status dots:
  - 🟢 **Synced**: Up-to-date with cloud storage.
  - 🟡 **Syncing...**: Actively synchronizing mutations.
  - ⚪ **Offline**: Safely queued locally; changes auto-sync as soon as your device reconnects.
- **1-Click Manual Sync**: Easily trigger an on-demand cloud sync at any moment.
- **Cloud Deep Links**: Share cloud-hosted trips effortlessly with URL parameters (`?trip=<tripId>`) that load the trip directly from Cloudflare D1.

### 📲 Serverless Peer Sync & WhatsApp Sharing
- **Conflict-Free Replicated Data Merging (CRDT)**: Merges friends' additions, edits, and deletions using Last-Write-Wins (LWW) with soft-delete tombstones (`deleted: true`, `updatedAt: Date.now()`), preventing accidental duplicates and resurrection of deleted items.
- **Zero-Server Multi-User Sync**: Share trips via compact Base64 sync codes (`TRIPSYNC1:...`) or direct sync URLs.
- **1-Click WhatsApp Settlement Share**: Export and format the complete debt settlement breakdown directly into WhatsApp chat.
- **1-Click WhatsApp Trip Invite**: Send a direct invite link via WhatsApp so friends can open the trip, select their identity, and contribute expenses.

### 📊 Reports, PDF & Backups
- **CSV Export**: Download trip expense data for spreadsheets (Excel, Google Sheets).
- **Print / Save as PDF**: Dedicated print stylesheet ensuring clean, paper-friendly styling and background contrast for physical archiving or PDF export.
- **Full Device Backup & Restore**: Export all trips into a single `.json` backup file and restore it on any device.

### 🎨 Clean, Mobile-First User Experience
- **100% Offline Capable**: All data is saved locally in browser `localStorage`.
- **Dark & Light Mode**: Seamless automatic theme detection with a manual toggle in the header.
- **Responsive Design**: Designed mobile-first for on-the-go tracking during travel, scaling gracefully to desktop screens.

---

## 🛠️ Tech Stack

- **Frontend**:
  - Semantic HTML5 markup
  - Modern Vanilla CSS3 with custom design system, CSS custom properties, and dedicated print stylesheets
  - Vanilla JavaScript (ES6+ Modules) — **Zero runtime dependencies or bundlers required**
- **Architecture**: Decoupled, modular layer design (Domain, Storage, UI, App orchestration)
- **Backend / Cloud Services**:
  - [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/platform/functions/) (Serverless REST API)
  - [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless distributed SQLite database)
- **Persistence**: Hybrid offline-first model (`localStorage` primary cache + Cloudflare D1 cloud sync)
- **Testing & Tooling**:
  - Native Node.js test runner (`node --test`) for pure domain logic & CRDT merge tests
  - [Playwright](https://playwright.dev/) for cross-browser end-to-end (E2E) integration testing

---

## 🚀 Getting Started

### 💻 Run Locally (No Build Tools Needed)

1. **Clone or Download** this repository:
   ```bash
   git clone https://github.com/jha-hrishikesh37/TripSplit.git
   cd TripSplit
   ```
2. **Serve the app locally**:
   - Because TripSplit uses native ES modules, serve it using any local static server:
     ```bash
     npx serve .
     # or
     python -m http.server 8000
     ```
   - Open your browser at `http://localhost:3000` (or `http://localhost:8000`).

---

## 🧪 Testing

TripSplit includes comprehensive automated test coverage for domain algorithms, state storage, and user journeys.

### Unit & Domain Tests (Node.js Native Test Runner)
Tests all pure domain logic (money calculations, split math, debt simplification) and CRDT merge algorithms:
```bash
npm test
# or directly:
node --test tests/domain.test.mjs
```

### End-to-End (E2E) Integration Tests (Playwright)
Executes end-to-end browser tests verifying UI flows, modals, calculations, and cloud sync status:
```bash
# Run all E2E tests
npm run test:e2e

# Run tests with the interactive Playwright UI
npm run test:e2e:ui
```

---

## ☁️ Cloudflare Pages & D1 Deployment

TripSplit is configured for zero-friction deployment to **Cloudflare Pages** with **Cloudflare D1** database bindings.

### Configuration Files
- `wrangler.toml`: Configures the Pages build output directory (`.`) and D1 database binding (`DB`).
- `migrations/0001_init.sql`: Creates the `trips` table with schema indexes.
- `functions/api/trips/[id]/sync.js`: Pages Function serving `GET` (trip retrieval) and `POST` (CRDT cloud synchronization).

### Local Development with Wrangler
To run the full stack locally (including Cloudflare Pages Functions and local D1 SQLite):
```bash
# Apply migrations to local D1 database
npx wrangler d1 migrations apply tripsplit-db --local

# Start the Pages local development server
npx wrangler pages dev .
```

### Production Deployment
```bash
# Apply migrations to remote production D1 database
npx wrangler d1 migrations apply tripsplit-db --remote

# Deploy to Cloudflare Pages
npx wrangler pages deploy .
```

---

## 📱 Application Walkthrough

The app is organized into four main tabs:

```
[ Expenses ]   [ Settle Up ]   [ Categories ]   [ Sync & Share ]
```

### 1. Expenses Tab
- Browse chronologically sorted expenses for the active trip.
- Filter expenses instantly using category pill buttons.
- Click the floating **"+ Add Expense"** button to enter title, amount, payer, date, and split distribution.
- Edit or delete existing expenses with safety confirmation prompts.

### 2. Settle Up Tab
- View the algorithmically computed minimum transactions needed to clear all debts.
- Click checkboxes to mark debts as settled as money changes hands.
- Share the formatted settlement summary directly to your travel WhatsApp group with one click.
- Inspect the detailed **Member Net Balances** table.

### 3. Categories Tab
- View an analytical breakdown of spending across all 6 categories:
  - 🍲 **Food & Drinks**
  - 🏨 **Stay & Hotel**
  - 🚕 **Travel & Fuel**
  - 🎟️ **Activities**
  - 🛍️ **Shopping**
  - 📦 **Other**

### 4. Sync & Share Tab
- **Cloud & Invite Links**: Share deep links (`?trip=<tripId>`) or WhatsApp invites to collaborate in real-time.
- **P2P Sync Codes**: Copy a `TRIPSYNC1:` Base64 sync code or download a sync `.json` file for zero-cloud peer syncing.
- **Merge Friend's Data**: Paste an incoming sync code or import their `.json` file to safely merge expenses with zero duplicates.
- **Reports & Backups**: Download CSV spreadsheets, trigger print/PDF generation, or create full device backups.

---

## 📁 Project Structure

```
TripSplit/
├── css/
│   └── styles.css              # Custom design system, CSS variables & print styles
├── functions/                  # Cloudflare Pages Functions (Serverless backend)
│   └── api/
│       └── trips/
│           └── [id]/
│               └── sync.js     # Cloudflare D1 cloud sync REST endpoint (GET & POST)
├── js/
│   ├── app.js                  # Main app bootstrap & DOM event orchestration
│   ├── config.js               # Application constants & schema version
│   ├── domain/                 # Pure domain logic (Zero DOM / zero side-effects)
│   │   ├── money.js            # Currency & paise integer conversions
│   │   ├── permissions.js      # Creator/member edit & delete authorization
│   │   ├── settlement.js       # Greedy cash-flow debt minimization algorithm
│   │   └── splits.js           # Equal, custom, and percentage split logic
│   ├── storage/                # Storage adapters, sync codecs & CRDT merge
│   │   ├── merge.js            # Last-Write-Wins (LWW) conflict resolution with tombstones
│   │   ├── seed.js             # Pre-loaded demo trip data
│   │   ├── storageAdapter.js   # LocalStorage & Cloudflare D1 auto-sync engine
│   │   └── syncCodec.js        # Base64 sync codes & URL hash codecs
│   └── ui/                     # UI view rendering & modals (DOM manipulation)
│       ├── expenseModal.js     # Add/edit expense modal
│       ├── helpers.js          # Toast notifications, modal helpers & HTML escaping
│       ├── state.js            # Reactive UI state container
│       ├── syncExport.js       # WhatsApp sharing, CSV export & JSON backups
│       ├── tripModal.js        # Trip creation & member management modal
│       └── views.js            # Tab views, expense cards & settlement checklists
├── migrations/
│   └── 0001_init.sql           # Cloudflare D1 database schema
├── tests/
│   ├── domain.test.mjs         # Node.js native unit tests (domain, money, merge, sync)
│   ├── e2e.spec.js             # Playwright E2E integration test suite
│   └── e2e/                    # E2E test specs & local test server
├── index.html                  # Semantic, accessible HTML markup
├── playwright.config.js        # Playwright test configuration
├── package.json                # Project scripts & development dependencies
├── wrangler.toml               # Cloudflare Pages & D1 database configuration
└── README.md                   # Comprehensive documentation & project guide
```

---

## 🔒 Privacy & Data Ownership

- **100% Offline-First**: Your data always lives locally in your device's browser `localStorage`.
- **Zero Account Friction**: No emails, passwords, phone numbers, or third-party sign-ins required.
- **Privacy-Centric Cloud Sync**: Cloud synchronization is scoped to trip identifiers with no user tracking, analytics, or behavioral telemetry.
- **Flexible Data Mobility**: Easily export all trips to CSV or complete JSON device backups anytime.

---

## 🔮 Roadmap

- [x] **Modular Architecture & Testing (Phase B)**: Refactored into clean ES modules (`js/domain`, `js/storage`, `js/ui`) with comprehensive Node.js unit tests and Playwright E2E suites.
- [x] **Cloud Sync with Cloudflare D1 (Phase C)**: Serverless backend using Cloudflare Pages Functions and Cloudflare D1 SQLite database, featuring debounced background sync, online/offline detection, and cloud deep links (`?trip=...`).
- [ ] **PWA Support**: Add `manifest.json` and a Service Worker for home-screen installation and offline caching.
- [ ] **Multi-Currency Support**: Add currency selector (USD, EUR, GBP, etc.) with custom exchange rates.
- [ ] **Receipt OCR**: Camera capture to auto-extract expense title and amount from receipts.

---

## 🤝 Contributing

Contributions and ideas are welcome! Feel free to fork the repository, open an issue, or submit a pull request.

---

## 📄 License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).
