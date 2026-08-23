# React + Firebase Gmail OTP Verification System

A production-ready Gmail OTP verification system built with **React**, **Vite**, **Firebase Realtime Database**, and a **server-side Node.js / Nodemailer** email engine. Designed to build and deploy seamlessly on **Vercel**, **Cloud Run**, and **GitHub**.

---

## ⚡ Direct Configuration & Secrets

- **Sender Gmail Address**: `manasipaine@gmail.com` (directly configured in server logic)
- **Firebase Realtime Database**: `https://hiiii-72d78-default-rtdb.firebaseio.com` (directly configured in client & server)
- **Only Required Secret / Environment Variable**: `GMAIL_APP_PASSWORD`

No other environment variables are required.

---

## 🔒 Security Architecture (Handled Server-Side)

All OTP security logic is strictly enforced server-side:

- **Cryptographic Hashing (SHA-256)**: Generated 6-digit OTPs are salted and hashed on the server before storing in Firebase Realtime Database. Plaintext codes are never stored.
- **5-Minute Expiration**: Every code expires in 300 seconds. Backend strictly checks timestamps.
- **One-Time Usage**: Upon successful verification, the temporary verification record in Firebase Realtime Database is immediately deleted. The same code cannot be used twice.
- **Attempt Limiting (Brute-Force Protection)**: Maximum 5 verification attempts per session. After 5 incorrect attempts, the record is locked and purged.
- **Resend Protection**: 60-second cooldown timer between resend requests. Previous OTPs are immediately invalidated when a new code is requested.
- **Protected Secrets**: Client-side React code contains zero private server keys and zero Google App Passwords.

---

## 📂 Project Structure

```
├── api/                        # Vercel Serverless Function handler
│   └── index.ts                # API router for Vercel (/api/status, /api/otp/*)
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
│   ├── server/
│   │   └── otpEngine.ts        # Shared server-side OTP hashing & email logic
│   │
│   ├── App.tsx                 # Main application state & view router
│   ├── main.tsx                # React DOM entrypoint
│   └── index.css               # Tailwind CSS styling
│
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions automated build
│
├── server.ts                   # Express server for local dev & container runs
├── vercel.json                 # Vercel deployment configuration & routing
├── database.rules.json         # Firebase Realtime Database rules
├── index.html                  # Root entry module
├── package.json
├── vite.config.ts
├── .gitignore
├── README.md
└── .env.example
```

---

## 🚀 Deployment on Vercel

1. Import the repository in [Vercel](https://vercel.com).
2. Framework Preset: **Vite** (detected automatically).
3. Build Command: `npm run build` or `vite build`.
4. Output Directory: `dist`.
5. Under **Environment Variables**, add:
   - `GMAIL_APP_PASSWORD`: Your 16-character Google App Password.
6. Click **Deploy**. Both the React frontend and `/api/*` serverless backend work out of the box.

---

## 🛠️ Setup & Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variable
Create a `.env` file with your Google App Password:
```env
GMAIL_APP_PASSWORD="your-16-char-app-password"
```

#### How to Generate a Google App Password:
1. Open [Google Account Security](https://myaccount.google.com/security).
2. Ensure **2-Step Verification** is turned **ON**.
3. In the search bar at the top of your Google Account page, search for **"App passwords"**.
4. Create an App Password (named `OTP Verification System`).
5. Copy the 16-character password into `GMAIL_APP_PASSWORD` in `.env` (or Vercel / GitHub Secrets).

---

### 3. Run Locally
```bash
npm run dev
```
The application runs on `http://localhost:3000`.

---

### 4. Build for Production
```bash
npm run build
```
Generates production-ready static assets in `dist/`.
