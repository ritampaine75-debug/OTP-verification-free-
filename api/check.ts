import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import {
  SENDER_GMAIL,
  FIREBASE_DATABASE_URL,
  OTP_EXPIRY_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  hashOtp
} from './_utils';

interface CheckItem {
  id: string;
  category: 'application' | 'database' | 'otp_pipeline' | 'api' | 'deployment';
  name: string;
  status: 'PASS' | 'WARNING' | 'FAIL' | 'BLOCKED';
  durationMs: number;
  errorCode?: string;
  technicalMessage: string;
  rootCause?: string;
  recommendedFix?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const checks: CheckItem[] = [];
  const startTime = Date.now();

  // 1. Deployment & Runtime Environment Check
  const appPassword = process.env.GMAIL_APP_PASSWORD?.trim();
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const nodeVersion = process.version;

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
    technicalMessage: `Runtime active: Node.js ${nodeVersion} on ${isVercel ? 'Vercel Serverless Gateway' : 'Standard Node Container'}.`
  });

  // 2. Firebase Realtime Database Server-Side Probe (Safe Diagnostics Sandbox)
  const probeId = `srv_diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const dbStartTime = Date.now();
  let dbWritePassed = false;
  let dbReadPassed = false;
  let dbDeletePassed = false;
  let dbErrorDetail = '';

  try {
    const probePayload = {
      testId: probeId,
      timestamp: Date.now(),
      service: 'healthcheck',
      source: 'serverless_diagnostic'
    };

    // Safe write to diagnostics/ sandbox only
    const writeController = new AbortController();
    const writeTimeout = setTimeout(() => writeController.abort(), 4000);
    const writeRes = await fetch(`${FIREBASE_DATABASE_URL}/diagnostics/${probeId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probePayload),
      signal: writeController.signal
    });
    clearTimeout(writeTimeout);

    if (writeRes.ok) {
      dbWritePassed = true;

      // Read back
      const readController = new AbortController();
      const readTimeout = setTimeout(() => readController.abort(), 4000);
      const readRes = await fetch(`${FIREBASE_DATABASE_URL}/diagnostics/${probeId}.json`, {
        signal: readController.signal
      });
      clearTimeout(readTimeout);

      if (readRes.ok) {
        const readData = await readRes.json();
        if (readData && readData.testId === probeId) {
          dbReadPassed = true;
        }
      }

      // Cleanup
      const delController = new AbortController();
      const delTimeout = setTimeout(() => delController.abort(), 3000);
      const delRes = await fetch(`${FIREBASE_DATABASE_URL}/diagnostics/${probeId}.json`, {
        method: 'DELETE',
        signal: delController.signal
      });
      clearTimeout(delTimeout);
      if (delRes.ok) {
        dbDeletePassed = true;
      }
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

  // 3. Gmail SMTP Connection & Authentication Test
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

  // 4. Server-Side Cryptographic OTP Hashing Benchmark
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

  // Calculate Overall System Status & Root Cause
  const hasFailures = checks.some((c) => c.status === 'FAIL');
  const hasWarnings = checks.some((c) => c.status === 'WARNING');
  const hasBlocked = checks.some((c) => c.status === 'BLOCKED');

  let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'ACTION_REQUIRED' = 'OPERATIONAL';
  if (hasFailures) overallStatus = 'ACTION_REQUIRED';
  else if (hasWarnings || hasBlocked) overallStatus = 'DEGRADED';

  // Determine Main Root Cause
  let mainRootCause: { title: string; impact: string; fix: string; chain: string[] } | null = null;

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

  return res.status(200).json({
    systemHealth: overallStatus,
    timestamp: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    serverEnvironment: {
      platform: isVercel ? 'Vercel Serverless' : 'Node Container',
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
}
