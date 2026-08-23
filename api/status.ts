import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  SENDER_GMAIL,
  OTP_EXPIRY_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  FIREBASE_DATABASE_URL
} from '../src/server/otpEngine';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const isGmailConfigured = Boolean(process.env.GMAIL_APP_PASSWORD && process.env.GMAIL_APP_PASSWORD.trim().length > 0);

  return res.status(200).json({
    status: 'online',
    gmailConfigured: isGmailConfigured,
    senderEmail: SENDER_GMAIL,
    databaseUrl: FIREBASE_DATABASE_URL,
    otpExpirySeconds: OTP_EXPIRY_MS / 1000,
    maxAttempts: MAX_ATTEMPTS,
    resendCooldownSeconds: RESEND_COOLDOWN_MS / 1000
  });
}
