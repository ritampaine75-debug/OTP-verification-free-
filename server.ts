import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  SENDER_GMAIL,
  firebaseConfig,
  OTP_EXPIRY_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  FIREBASE_DATABASE_URL,
  OtpRecord,
  hashOtp,
  saveOtpToFirebase,
  getOtpFromFirebase,
  deleteOtpFromFirebase,
  updateOtpInFirebase,
  invalidatePreviousOtpsForEmail,
  sendOtpEmail
} from './src/server/otpEngine';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// System Status Endpoint
app.get('/api/status', (req, res) => {
  const isGmailConfigured = Boolean(process.env.GMAIL_APP_PASSWORD && process.env.GMAIL_APP_PASSWORD.trim().length > 0);
  res.json({
    status: 'online',
    gmailConfigured: isGmailConfigured,
    senderEmail: SENDER_GMAIL,
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
      demoOtp: emailResult.demoMode ? otp : undefined,
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
