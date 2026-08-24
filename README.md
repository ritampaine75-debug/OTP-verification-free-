# Gmail OTP Verification Architecture

A production-grade, secure email verification system built with **React 19**, **Node.js / Express**, **Firebase Realtime Database**, and **GitHub Actions**.

---

## 🏛️ Architecture Overview

- **Single Source of Truth**: GitHub Repository (`.github/workflows/`, GitHub Secrets, Variables).
- **Frontend**: React 19 + Tailwind CSS + Lucide Icons + Motion.
- **Backend**: Express & Serverless API Routes (`/api/status`, `/api/check`, `/api/otp/*`).
- **Database**: Firebase Realtime Database (`https://hiiii-72d78-default-rtdb.firebaseio.com`).
- **Email Delivery**: Gmail SMTP via `manasipaine@gmail.com` using GitHub Secret `GMAIL_APP_PASSWORD`.
- **Diagnostic Engine**: GitHub Actions automated pipeline (`.github/workflows/diagnostic.yml`) with root cause dependency analysis.

---

## 🔐 Security & OTP Lifecycle

1. **6-Digit Cryptographic Code**: Generated using Cryptographically Secure Pseudo-Random Number Generation (`crypto.randomInt(100000, 1000000)`).
2. **SHA-256 Salted Hashing**: The plaintext OTP is **never** persisted in the database or returned in production responses. Only a salted SHA-256 hash is stored.
3. **5-Minute Auto-Expiry**: Strict 300-second window. Expired records are rejected with HTTP 410 and deleted.
4. **5-Attempt Lockout**: Anti brute-force protection. After 5 incorrect entries, the session is invalidated with HTTP 429.
5. **60-Second Cooldown**: Prevents rate-limit exhaustion and email spam.
6. **Single-Use Deletion**: The temporary verification record is purged from Firebase Realtime Database immediately upon successful verification.

---

## ⚙️ GitHub Secrets Configuration

Configure the following secrets in your GitHub repository (**Settings &gt; Secrets and variables &gt; Actions**):

| Secret Name | Description |
|---|---|
| `GITHUB_TOKEN` | GitHub Authentication token for running Actions & diagnostics (built-in or fine-grained PAT) |
| `GMAIL_APP_PASSWORD` | 16-character Google App Password for `manasipaine@gmail.com` |

*Note: No secrets are required in hosting platforms like Vercel.*

---

## 🔍 Automated Diagnostic System (`/check`)

Access the `/check` dashboard in the web application or trigger the GitHub Actions workflow at `.github/workflows/diagnostic.yml`.

The diagnostic system performs multi-tier evaluations:
- **Build & Project Integrity**: Project structure, TypeScript typecheck, Vite production compilation.
- **OTP Cryptographic Engine**: CSPRNG generation, SHA-256 salted hash, 300s window math.
- **Firebase RTDB**: REST sandbox read/write/delete verification.
- **Secrets & SMTP**: GitHub Secrets check and SMTP handshake verification.
- **Root Cause Detection**: Isolates primary root failures from downstream secondary consequences.
