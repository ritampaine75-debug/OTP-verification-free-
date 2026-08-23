import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Configuration Constants
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const SECRET_SALT = process.env.OTP_SECRET_SALT || 'otp-secure-salt-2025-firebase';
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://hiiii-72d78-default-rtdb.firebaseio.com';

// Interface for OTP Verification Record
interface OtpRecord {
  verificationId: string;
  email: string;
  otpHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  verified: boolean;
  resendCount: number;
}

// In-Memory store fallback + sync mechanism with Firebase Realtime Database
const localOtpStore = new Map<string, OtpRecord>();

// Helper to hash OTP using SHA-256 with server-side secret salt
function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp.trim() + SECRET_SALT).digest('hex');
}

// Firebase Realtime Database REST helper functions
async function saveOtpToFirebase(record: OtpRecord): Promise<void> {
  localOtpStore.set(record.verificationId, record);
  try {
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${record.verificationId}.json`;
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    });
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud write warning (persisted locally):', err);
  }
}

async function getOtpFromFirebase(verificationId: string): Promise<OtpRecord | null> {
  // Check local cache first
  if (localOtpStore.has(verificationId)) {
    return localOtpStore.get(verificationId)!;
  }
  try {
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data) {
      localOtpStore.set(verificationId, data);
      return data as OtpRecord;
    }
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud read warning:', err);
  }
  return null;
}

async function deleteOtpFromFirebase(verificationId: string): Promise<void> {
  localOtpStore.delete(verificationId);
  try {
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    await fetch(url, { method: 'DELETE' });
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud delete warning:', err);
  }
}

async function updateOtpInFirebase(verificationId: string, updates: Partial<OtpRecord>): Promise<void> {
  const existing = localOtpStore.get(verificationId);
  if (existing) {
    Object.assign(existing, updates);
  }
  try {
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud patch warning:', err);
  }
}

async function invalidatePreviousOtpsForEmail(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  // Clear from local store
  for (const [id, rec] of localOtpStore.entries()) {
    if (rec.email === normalizedEmail) {
      localOtpStore.delete(id);
      try {
        const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${id}.json`;
        fetch(url, { method: 'DELETE' }).catch(() => {});
      } catch {
        // ignore
      }
    }
  }
}

// Nodemailer Gmail Setup
function getMailTransporter() {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass
    }
  });
}

// Send OTP Email via Gmail SMTP
async function sendOtpEmail(toEmail: string, otp: string): Promise<{ sent: boolean; demoMode: boolean; error?: string }> {
  const transporter = getMailTransporter();

  if (!transporter) {
    console.info(`[Demo Mode] Simulated Gmail Dispatch to ${toEmail}. Generated OTP: [${otp}]`);
    return {
      sent: true,
      demoMode: true
    };
  }

  try {
    await transporter.sendMail({
      from: `"Verification Security" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: `Your Verification Code: ${otp}`,
      text: `Your verification code\n\n${otp}\n\nThis code expires in 5 minutes.\n\nIf you did not request this code, you can ignore this email.`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; }
            .card { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .header { text-align: center; margin-bottom: 24px; }
            .title { color: #0f172a; font-size: 22px; font-weight: 700; margin: 0 0 8px 0; }
            .subtitle { color: #64748b; font-size: 14px; margin: 0; }
            .code-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
            .code { font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #2563eb; margin: 0; }
            .expiry { color: #475569; font-size: 14px; margin-bottom: 20px; line-height: 1.6; }
            .footer { border-top: 1px solid #f1f5f9; padding-top: 16px; color: #94a3b8; font-size: 12px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1 class="title">Your verification code</h1>
              <p class="subtitle">Please use the code below to complete your verification</p>
            </div>
            <div class="code-box">
              <div class="code">${otp}</div>
            </div>
            <p class="expiry">This code expires in <strong>5 minutes</strong>. For your security, never share this code with anyone.</p>
            <div class="footer">
              <p>If you did not request this code, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    return { sent: true, demoMode: false };
  } catch (err: any) {
    console.error('Failed to send mail via SMTP:', err);
    return { sent: false, demoMode: false, error: err.message || 'SMTP delivery failed' };
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// System Status Endpoint
app.get('/api/status', (req, res) => {
  const isGmailConfigured = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  res.json({
    status: 'online',
    gmailConfigured: isGmailConfigured,
    senderEmail: isGmailConfigured ? process.env.GMAIL_USER : null,
    databaseUrl: FIREBASE_DATABASE_URL,
    otpExpirySeconds: OTP_EXPIRY_MS / 1000,
    maxAttempts: MAX_ATTEMPTS,
    resendCooldownSeconds: RESEND_COOLDOWN_MS / 1000
  });
});

// 1. Send OTP Endpoint
app.post('/api/otp/send', async (req, res) => {
  try {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Invalidate any previous OTPs for this email address
    await invalidatePreviousOtpsForEmail(normalizedEmail);

    // Generate cryptographically secure 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const verificationId = crypto.randomUUID();
    const otpHash = hashOtp(otp);
    const createdAt = Date.now();
    const expiresAt = createdAt + OTP_EXPIRY_MS;

    const record: OtpRecord = {
      verificationId,
      email: normalizedEmail,
      otpHash,
      createdAt,
      expiresAt,
      attempts: 0,
      verified: false,
      resendCount: 0
    };

    // Store hashed OTP record in Firebase Realtime Database
    await saveOtpToFirebase(record);

    // Send email via Gmail SMTP
    const emailResult = await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({
      success: true,
      verificationId,
      expiresAt,
      demoMode: emailResult.demoMode,
      demoOtp: emailResult.demoMode ? otp : undefined, // Provided only when SMTP credentials are not yet configured in .env for instant local preview
      message: emailResult.demoMode
        ? 'Verification code generated (Demo mode: Gmail SMTP credentials pending in .env).'
        : 'A 6-digit verification code has been sent to your Gmail inbox.'
    });
  } catch (error: any) {
    console.error('Error sending OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process verification request. Please try again.'
    });
  }
});

// 2. Verify OTP Endpoint
app.post('/api/otp/verify', async (req, res) => {
  try {
    const { verificationId, email, otp } = req.body;

    if (!verificationId || !email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Verification ID, email, and 6-digit code are required.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const record = await getOtpFromFirebase(verificationId);

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Verification session not found or already completed. Please request a new code.'
      });
    }

    if (record.email !== normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email address does not match this verification session.'
      });
    }

    const now = Date.now();

    // 5-Minute Expiration Verification
    if (now >= record.expiresAt) {
      await deleteOtpFromFirebase(verificationId);
      return res.status(400).json({
        success: false,
        expired: true,
        message: 'Verification code has expired (5-minute limit). Please request a new code.'
      });
    }

    // Attempt Limit Verification (Max 5 attempts)
    const nextAttempts = (record.attempts || 0) + 1;
    if (nextAttempts > MAX_ATTEMPTS) {
      await deleteOtpFromFirebase(verificationId);
      return res.status(429).json({
        success: false,
        locked: true,
        message: 'Maximum verification attempts exceeded. Session locked for security. Please request a new code.'
      });
    }

    // Compare Hash of Submitted OTP
    const submittedHash = hashOtp(otp.trim());
    if (submittedHash !== record.otpHash) {
      await updateOtpInFirebase(verificationId, { attempts: nextAttempts });
      const remainingAttempts = MAX_ATTEMPTS - nextAttempts;
      return res.status(400).json({
        success: false,
        remainingAttempts,
        message: remainingAttempts > 0
          ? `Incorrect code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`
          : 'Maximum attempts reached. Session has been locked.'
      });
    }

    // SUCCESSFUL VERIFICATION
    // 1. Immediately delete the temporary OTP record from Firebase RTDB so it cannot be reused
    await deleteOtpFromFirebase(verificationId);

    // 2. Return success response
    return res.status(200).json({
      success: true,
      verified: true,
      email: normalizedEmail,
      verifiedAt: now,
      message: 'Email address verified successfully!'
    });
  } catch (error: any) {
    console.error('Error verifying OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during verification. Please try again.'
    });
  }
});

// 3. Resend OTP Endpoint
app.post('/api/otp/resend', async (req, res) => {
  try {
    const { verificationId, email } = req.body;
    if (!verificationId || !email) {
      return res.status(400).json({
        success: false,
        message: 'Verification ID and email are required to resend.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const oldRecord = await getOtpFromFirebase(verificationId);

    if (oldRecord) {
      const elapsed = Date.now() - oldRecord.createdAt;
      if (elapsed < RESEND_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          success: false,
          cooldownRemaining: remainingSeconds,
          message: `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} before requesting a new code.`
        });
      }
      // Invalidate old OTP
      await deleteOtpFromFirebase(verificationId);
    }

    // Generate new OTP
    const newOtp = crypto.randomInt(100000, 1000000).toString();
    const newVerificationId = crypto.randomUUID();
    const newOtpHash = hashOtp(newOtp);
    const createdAt = Date.now();
    const expiresAt = createdAt + OTP_EXPIRY_MS;

    const newRecord: OtpRecord = {
      verificationId: newVerificationId,
      email: normalizedEmail,
      otpHash: newOtpHash,
      createdAt,
      expiresAt,
      attempts: 0,
      verified: false,
      resendCount: ((oldRecord?.resendCount || 0) + 1)
    };

    await saveOtpToFirebase(newRecord);
    const emailResult = await sendOtpEmail(normalizedEmail, newOtp);

    return res.status(200).json({
      success: true,
      verificationId: newVerificationId,
      expiresAt,
      demoMode: emailResult.demoMode,
      demoOtp: emailResult.demoMode ? newOtp : undefined,
      message: emailResult.demoMode
        ? 'New verification code generated (Demo mode).'
        : 'A new 6-digit code has been sent to your Gmail.'
    });
  } catch (error: any) {
    console.error('Error resending OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend verification code. Please try again.'
    });
  }
});

// Vite Integration for Development and Production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {}
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} (${isProduction ? 'Production' : 'Development'})`);
  });
}

startServer();
