# React + Firebase Gmail OTP Verification System

A secure, production-ready Gmail OTP verification system built with **React**, **Vite**, **Firebase Realtime Database**, and a **server-side Node.js / Nodemailer** email engine.

---

## 🔒 Security Architecture

- **Server-Side Cryptographic Hashing**: OTPs are generated on the server (`crypto.randomInt`) and stored exclusively as salted **SHA-256 hashes**. Plaintext OTPs are never stored in Firebase.
- **5-Minute Expiration**: Every code expires in 300 seconds. Backend strictly checks timestamps.
- **One-Time Usage**: Upon successful verification, the temporary verification record in Firebase Realtime Database is immediately deleted. The same code cannot be used twice.
- **Attempt Limiting (Brute-Force Protection)**: Maximum 5 verification attempts per session. After 5 incorrect attempts, the record is locked and purged.
- **Resend Protection**: 60-second cooldown timer between resend requests. Previous OTPs are immediately invalidated when a new code is requested.
- **Protected Secrets**: Client-side React code contains zero private server keys, zero SMTP credentials, and zero Google App Passwords.

---

## 📂 Project Structure

```
otp-verification/
│
├── src/
│   ├── components/
│   │   ├── EmailForm.tsx        # Email input, validation & submission
│   │   ├── OtpForm.tsx          # 6-digit split input, paste & resend handler
│   │   ├── CountdownTimer.tsx   # 5-minute visual countdown timer
│   │   └── VerificationStatus.tsx # Verified badge & confirmation details
│   │
│   ├── firebase/
│   │   └── firebaseConfig.ts   # Public client Firebase configuration
│   │
│   ├── App.tsx                 # Main application state & view router
│   ├── main.tsx                # React DOM entrypoint
│   └── index.css               # Tailwind CSS styling
│
├── functions/                  # Firebase Cloud Functions (optional deployment)
│   ├── index.js                # Serverless HTTPS endpoints
│   ├── package.json
│   └── .env.example
│
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions automated build & deploy
│
├── server.ts                   # Express server with Vite middleware & API routes
├── firebase.json               # Firebase hosting & database configuration
├── database.rules.json         # Firebase Realtime Database security rules
├── package.json
├── vite.config.ts
├── .gitignore
├── README.md
└── .env.example                # Template for environment variables
```

---

## 🚀 Setup & Installation Guide

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in the required server environment variables:

```env
# Gmail SMTP Credentials
GMAIL_USER="your-email@gmail.com"
GMAIL_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"

# Firebase Realtime Database URL
FIREBASE_DATABASE_URL="https://hiiii-72d78-default-rtdb.firebaseio.com"

# Secret Salt for SHA-256 Hashing
OTP_SECRET_SALT="your-cryptographic-salt-key"
```

> ⚠️ **CRITICAL**: Never commit your `.env` file to source control.

---

### 3. Gmail 2-Step Verification & Google App Password

To allow the server to securely dispatch verification emails via Gmail SMTP:

1. Open your [Google Account Security Settings](https://myaccount.google.com/security).
2. Ensure **2-Step Verification** is turned **ON**.
3. In the search bar at the top of the Google Account page, search for **"App passwords"**.
4. Create a new App Password (e.g. named `OTP Verification System`).
5. Copy the generated 16-character password (e.g., `abcd efgh ijkl mnop`).
6. Place this into `GMAIL_APP_PASSWORD` in your `.env` file (without spaces).

---

### 4. Firebase Realtime Database Setup & Security Rules

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project (e.g. `hiiii-72d78`).
3. Navigate to **Build &gt; Realtime Database**.
4. In the **Rules** tab, deploy the rules defined in `database.rules.json`:

```json
{
  "rules": {
    "otpVerifications": {
      ".read": false,
      ".write": false
    },
    "verifiedUsers": {
      ".read": "auth != null",
      ".write": false
    },
    ".read": false,
    ".write": false
  }
}
```

This prevents any client-side unauthorized reads or writes to the OTP verification cache.

---

### 5. Local Development

Start the development server:

```bash
npm run dev
```

The application runs on `http://localhost:3000`.

---

### 6. GitHub Secrets & CI/CD Deployment

To configure automated builds with GitHub Actions:

1. Push this repository to GitHub.
2. In your GitHub repository, navigate to **Settings &gt; Secrets and variables &gt; Actions**.
3. Add the following repository secrets:
   - `GMAIL_USER`
   - `GMAIL_APP_PASSWORD`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_SERVICE_ACCOUNT` (or `FIREBASE_TOKEN`)
4. The workflow in `.github/workflows/deploy.yml` will automatically build and deploy the application on push to `main`.

---

### 7. Production Build

To build the static frontend bundle:

```bash
npm run build
```

To run the production Node.js server:

```bash
npm start
```
