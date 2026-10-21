# TripSplit — Smart Group Trip Expense & Settlement Tracker

[![Live Demo](https://img.shields.io/badge/Live%20Demo-tripsplit--9ju.pages.dev-success?style=for-the-badge&logo=cloudflarepages)](https://tripsplit-9ju.pages.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**TripSplit** is a lightweight, privacy-focused, zero-dependency web application designed to eliminate the friction of splitting expenses during group trips. It runs completely in the browser, requires no account creation or backend server, and automatically calculates the minimum number of transactions needed to settle all debts.

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
  - **Equal Split**: Evenly divides expenses among all or selected members.
  - **Custom Split (₹)**: Assign exact amounts to specific members with real-time total matching validation.
  - **Percentage Split (%)**: Split expenses based on custom percentages.
- **Payer Designation**: Supports expenses paid by any group member with date tracking.
- **Subunit Precision (Paise)**: All calculations run on integer subunits to eliminate floating-point rounding errors (`₹0.01` accuracy).

### ⚖️ Debt Minimization & Settle-Up Checklist
- **Optimized Settlement Plan**: Uses a greedy cash-flow minimization algorithm to reduce complicated group debts into the fewest possible payments.
- **Interactive Checklist**: Mark individual settlement recommendations as completed as friends pay up.
- **Live Progress Bar**: Visual progress indicator (`X / Y Settled`) that automatically updates net balances as payments are recorded.
- **Net Balances View**: Transparent breakdown of total spent, total share, and current net standing for every member.

### 📲 Serverless Peer Sync & WhatsApp Sharing
- **Zero-Server Multi-User Sync**: Share trip state with friends using compact Base64 sync codes (`TRIPSYNC1:...`) or invite links.
- **CRDT Conflict-Free Merging**: Automatically merges friends' additions, edits, and deletions using Last-Write-Wins without duplicating entries or requiring a database.
- **1-Click WhatsApp Settlement Share**: Export and format the complete debt settlement breakdown directly into WhatsApp chat.
- **1-Click WhatsApp Trip Invite**: Send a direct invite link via WhatsApp so friends can open the trip, select their name, and add their own expenses.

### 📊 Reports, PDF & Backups
- **CSV Export**: Download trip expense data for spreadsheets (Excel, Google Sheets).
- **Print / Save as PDF**: Clean, printer-friendly layout for physical archiving or PDF generation.
- **Full Device Backup & Restore**: Export all your trips into a single `.json` backup file and restore it on any device.

### 🎨 Clean, Mobile-First User Experience
- **100% Offline Capable**: All data is saved locally in the browser's `localStorage`.
- **Dark & Light Mode**: Seamless automatic theme detection with a manual toggle in the header.
- **Responsive Design**: Designed mobile-first for on-the-go tracking during travel, while scaling beautifully to desktop screens.

---

## 🛠️ Tech Stack

- **Architecture**: Single-File Web Application (100% self-contained)
- **Frontend**: HTML5, Vanilla CSS3 (Custom Design System with CSS Variables), Modern Vanilla JavaScript (ES6+)
- **Storage**: Browser `localStorage` with Cloudflare D1-ready service abstraction
- **Dependencies**: **Zero** external libraries or build tools required

---

## 🚀 Getting Started

### 🌐 Use Online (Instant & Free)
You can use TripSplit immediately on your mobile phone or computer without installing anything:
👉 **[Launch TripSplit on Cloudflare Pages](https://tripsplit-9ju.pages.dev/)**

### 💻 Run Locally (No Build Tools Needed)
If you prefer running it locally on your computer:

1. **Clone or Download** this repository:
   ```bash
   git clone https://github.com/jha-hrishikesh37/TripSplit.git
   ```
2. **Open the app**:
   - Simply double-click `index.html` in your file explorer to open it in any modern browser (Chrome, Safari, Firefox, Edge).
   - Alternatively, serve it locally with any lightweight server:
     ```bash
     npx serve .
     # or
     python -m http.server 8000
     ```

### ☁️ Deploy Your Own Instance
Because TripSplit is a static single-page app, you can also deploy your own copy for free in seconds on:
- **Cloudflare Pages / Vercel / Netlify**: Link your GitHub repository with zero configuration.
- **GitHub Pages**: Push to `main` and enable GitHub Pages in repository settings.

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
- **Share / Invite**: Generate a WhatsApp invite link, copy a `TRIPSYNC1:` code, or download a sync `.json` file.
- **Merge Friend's Data**: Paste an incoming sync code or import their `.json` file to safely merge expenses with zero duplicates.
- **Reports & Backups**: Download CSV spreadsheets, trigger print/PDF generation, or create full device backups.

---

## 🔒 Privacy & Data Ownership

- **100% Local**: Your data lives inside your device's browser `localStorage`.
- **No Cloud Tracking**: No analytics, trackers, or telemetry scripts.
- **No Accounts**: No emails, passwords, phone numbers, or third-party sign-ins.
- **Private Sharing**: When sharing via WhatsApp or sync codes, data travels peer-to-peer through your chosen channel without touching intermediary servers.

---

## 📁 Project Structure

```
TripSplit/
├── index.html          # Self-contained single-page application (UI, styles & logic)
└── README.md           # Documentation & user guide
```

---

## 🔮 Future Roadmap

- [ ] **PWA Support**: Add `manifest.json` and a Service Worker for home-screen installation and offline caching.
- [ ] **Multi-Currency Support**: Add currency selector (USD, EUR, GBP, etc.) with custom exchange rates.
- [ ] **Optional Cloud Sync**: Optional Cloudflare Worker + D1 adapter for automated multi-device background sync.
- [ ] **Receipt OCR**: Camera capture to auto-extract expense title and amount from receipts.

---

## 🤝 Contributing

Contributions and ideas are welcome! Feel free to fork the repository, open an issue, or submit a pull request.

---

## 📄 License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).
