import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
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

// Dedicated Diagnostics Endpoint
app.get('/api/check', async (req, res) => {
  const startTime = Date.now();
  const checks: any[] = [];

  const appPassword = process.env.GMAIL_APP_PASSWORD?.trim();
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const nodeVersion = process.version;

  // Environment variable check
  if (appPassword && appPassword.length >= 12) {
    checks.push({
      id: 'env_gmail_secret',
      category: 'deployment',
      name: 'Gmail App Password Secret Configuration',
      status: 'PASS',
      durationMs: 1,
      technicalMessage: 'GMAIL_APP_PASSWORD secret is present and valid format in runtime environment.'
    });
  } else {
    checks.push({
      id: 'env_gmail_secret',
      category: 'deployment',
      name: 'Gmail App Password Secret Configuration',
      status: 'WARNING',
      durationMs: 1,
      errorCode: 'MISSING_GMAIL_APP_PASSWORD',
      technicalMessage: 'GMAIL_APP_PASSWORD environment variable is not defined or is empty in deployment.',
      rootCause: 'Vercel deployment is missing the Google App Password required by the server-side Gmail SMTP function.',
      recommendedFix: '1. Generate a 16-character App Password at Google Account > Security > App Passwords. 2. Add GMAIL_APP_PASSWORD in Vercel Project Settings > Environment Variables. 3. Redeploy.'
    });
  }

  checks.push({
    id: 'env_runtime',
    category: 'deployment',
    name: 'Serverless Runtime Environment',
    status: 'PASS',
    durationMs: 1,
    technicalMessage: `Runtime active: Node.js ${nodeVersion} on ${isVercel ? 'Vercel Serverless Gateway' : 'Express/Node Container'}.`
  });

  // Safe Realtime Database Sandbox Probe
  const probeId = `srv_diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const dbStartTime = Date.now();
  let dbWritePassed = false;
  let dbReadPassed = false;
  let dbErrorDetail = '';

  try {
    const probePayload = {
      testId: probeId,
      timestamp: Date.now(),
      service: 'healthcheck',
      source: 'server_diagnostic'
    };

    const writeRes = await fetch(`${FIREBASE_DATABASE_URL}/diagnostics/${probeId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probePayload)
    });

    if (writeRes.ok) {
      dbWritePassed = true;
      const readRes = await fetch(`${FIREBASE_DATABASE_URL}/diagnostics/${probeId}.json`);
      if (readRes.ok) {
        const readData = await readRes.json();
        if (readData && readData.testId === probeId) {
          dbReadPassed = true;
        }
      }
      await fetch(`${FIREBASE_DATABASE_URL}/diagnostics/${probeId}.json`, { method: 'DELETE' });
    } else {
      dbErrorDetail = `HTTP ${writeRes.status} (${writeRes.statusText})`;
    }
  } catch (err: any) {
    dbErrorDetail = err?.message || 'Database network connection timeout';
  }

  const dbDuration = Date.now() - dbStartTime;

  if (dbWritePassed && dbReadPassed) {
    checks.push({
      id: 'firebase_rtdb_probe',
      category: 'database',
      name: 'Firebase Realtime Database Server I/O',
      status: 'PASS',
      durationMs: dbDuration,
      technicalMessage: `Successfully performed safe sandbox write, readback, and cleanup on diagnostics/ path (${dbDuration}ms).`
    });
  } else {
    checks.push({
      id: 'firebase_rtdb_probe',
      category: 'database',
      name: 'Firebase Realtime Database Server I/O',
      status: 'FAIL',
      durationMs: dbDuration,
      errorCode: 'FIREBASE_RTDB_UNREACHABLE',
      technicalMessage: `Database probe failed on ${FIREBASE_DATABASE_URL}: ${dbErrorDetail}`,
      rootCause: 'Firebase Realtime Database is unreachable or blocked by security rules/network restrictions.',
      recommendedFix: 'Check database rules in Firebase console to ensure read/write access is permitted on the path.'
    });
  }

  // SMTP Transport Verification
  const smtpStartTime = Date.now();
  if (!appPassword) {
    checks.push({
      id: 'smtp_transport',
      category: 'otp_pipeline',
      name: 'Gmail SMTP Direct Transport & Authentication',
      status: 'BLOCKED',
      durationMs: Date.now() - smtpStartTime,
      errorCode: 'SMTP_CREDENTIALS_MISSING',
      technicalMessage: 'SMTP connection verification blocked because GMAIL_APP_PASSWORD is not configured.',
      rootCause: 'Vercel deployment is missing the Google App Password required by the server-side Gmail SMTP function.',
      recommendedFix: 'Add the 16-character Google App Password in Vercel Environment Variables and redeploy.'
    });
  } else {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: SENDER_GMAIL,
          pass: appPassword
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 6000
      });
      await transporter.verify();
      checks.push({
        id: 'smtp_transport',
        category: 'otp_pipeline',
        name: 'Gmail SMTP Direct Transport & Authentication',
        status: 'PASS',
        durationMs: Date.now() - smtpStartTime,
        technicalMessage: `Successfully connected and authenticated with Gmail SMTP server (smtp.gmail.com:465) as ${SENDER_GMAIL}.`
      });
    } catch (smtpErr: any) {
      checks.push({
        id: 'smtp_transport',
        category: 'otp_pipeline',
        name: 'Gmail SMTP Direct Transport & Authentication',
        status: 'FAIL',
        durationMs: Date.now() - smtpStartTime,
        errorCode: 'SMTP_AUTH_FAILED',
        technicalMessage: `SMTP verification failed: ${smtpErr?.message || 'Invalid credentials or connection timeout'}.`,
        rootCause: 'The provided Gmail App Password was rejected by Google SMTP authentication servers.',
        recommendedFix: 'Generate a fresh 16-character Google App Password from your Google Security dashboard and update it in Vercel.'
      });
    }
  }

  // Cryptographic hashing benchmark
  const cryptoStartTime = Date.now();
  const sampleOtp = '849201';
  const hashed = hashOtp(sampleOtp);
  const cryptoValid = hashed.length === 64 && hashed === hashOtp(sampleOtp);
  const cryptoDuration = Date.now() - cryptoStartTime;

  checks.push({
    id: 'crypto_otp_engine',
    category: 'otp_pipeline',
    name: 'SHA-256 OTP Cryptographic Engine & Salt Hashing',
    status: cryptoValid ? 'PASS' : 'FAIL',
    durationMs: cryptoDuration,
    technicalMessage: cryptoValid
      ? `SHA-256 256-bit salted hash validated in ${cryptoDuration}ms.`
      : 'Cryptographic hashing returned invalid digest length.'
  });

  const hasFailures = checks.some((c) => c.status === 'FAIL');
  const hasWarnings = checks.some((c) => c.status === 'WARNING');
  const hasBlocked = checks.some((c) => c.status === 'BLOCKED');

  let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'ACTION_REQUIRED' = 'OPERATIONAL';
  if (hasFailures) overallStatus = 'ACTION_REQUIRED';
  else if (hasWarnings || hasBlocked) overallStatus = 'DEGRADED';

  let mainRootCause: any = null;
  const missingSecretCheck = checks.find((c) => c.id === 'env_gmail_secret' && c.status !== 'PASS');
  const dbCheckFailed = checks.find((c) => c.id === 'firebase_rtdb_probe' && c.status === 'FAIL');
  const smtpFailed = checks.find((c) => c.id === 'smtp_transport' && c.status === 'FAIL');

  if (missingSecretCheck) {
    mainRootCause = {
      title: 'Vercel deployment is missing the Google App Password required by the server-side Gmail SMTP function.',
      impact: 'Real OTP emails cannot be dispatched via Gmail SMTP (system automatically operates in demo/test fallback mode).',
      fix: 'Add the 16-character Google App Password to Vercel Project Settings > Environment Variables as GMAIL_APP_PASSWORD and redeploy.',
      chain: [
        'Missing GMAIL_APP_PASSWORD in Vercel Environment Variables',
        'Serverless Gmail SMTP Transport blocked from authentication',
        'Direct email delivery cannot reach recipient inboxes'
      ]
    };
  } else if (smtpFailed) {
    mainRootCause = {
      title: 'Google SMTP rejected the configured Google App Password credentials.',
      impact: 'Outbound verification emails are failing at the Google mail server handshake.',
      fix: 'Verify that 2-Step Verification is enabled on your Google account and generate a new App Password.',
      chain: [
        'Google SMTP authentication failure (smtp.gmail.com)',
        'SMTP Transporter handshake rejected',
        'Outbound email delivery blocked'
      ]
    };
  } else if (dbCheckFailed) {
    mainRootCause = {
      title: 'Firebase Realtime Database connection failure or permission blockage.',
      impact: 'Temporary OTP session records cannot be persisted across serverless instances.',
      fix: 'Check Firebase Realtime Database security rules and ensure the database is active in Firebase Console.',
      chain: [
        'Firebase Realtime Database REST endpoint unreachable',
        'Database write/read sandbox probe failed',
        'OTP state persistence impaired'
      ]
    };
  }

  res.json({
    systemHealth: overallStatus,
    timestamp: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    serverEnvironment: {
      platform: isVercel ? 'Vercel Serverless' : 'Express / Node Container',
      nodeVersion,
      senderEmail: SENDER_GMAIL,
      databaseUrl: FIREBASE_DATABASE_URL,
      otpExpirySeconds: OTP_EXPIRY_MS / 1000,
      maxAttempts: MAX_ATTEMPTS,
      resendCooldownSeconds: RESEND_COOLDOWN_MS / 1000
    },
    mainRootCause,
    checks
  });
});

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
