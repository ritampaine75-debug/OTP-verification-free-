import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SENDER_GMAIL, FIREBASE_DATABASE_URL } from './_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const hasAppPassword = !!process.env.GMAIL_APP_PASSWORD?.trim();
  const hasGitHubToken = !!(process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim());

  return res.status(200).json({
    status: 'ok',
    service: 'Gmail OTP Verification API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    config: {
      senderEmail: SENDER_GMAIL,
      firebaseDatabaseUrl: FIREBASE_DATABASE_URL,
      otpExpirySeconds: 300,
      maxAttempts: 5,
      resendCooldownSeconds: 60,
      smtpConfigured: hasAppPassword,
      gitHubTokenConfigured: hasGitHubToken,
      environment: process.env.NODE_ENV || 'development'
    }
  });
}
