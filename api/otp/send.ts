import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import {
  generateSecureOtp,
  hashOtp,
  saveOtpToFirebase,
  sendOtpEmail,
  OTP_EXPIRY_MS,
  RESEND_COOLDOWN_MS,
  SENDER_GMAIL
} from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.trim().toLowerCase();

    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    // 1. Generate 6-digit cryptographically secure OTP
    const otp = generateSecureOtp();
    const verificationId = `v_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const expiresAt = now + OTP_EXPIRY_MS; // Strict 5 minutes

    // 2. Hash OTP before saving to Firebase Realtime Database
    const otpHash = hashOtp(otp);

    const record = {
      verificationId,
      email: cleanEmail,
      otpHash,
      createdAt: now,
      expiresAt,
      attempts: 0,
      verified: false,
      resendCount: 0,
      lastSentAt: now
    };

    // 3. Persist hashed OTP session in Firebase Realtime Database
    await saveOtpToFirebase(record);

    // 4. Send email via Gmail SMTP from manasipaine@gmail.com
    const emailResult = await sendOtpEmail(cleanEmail, otp);

    const isProduction = !!process.env.GMAIL_APP_PASSWORD?.trim();

    return res.status(200).json({
      success: true,
      verificationId,
      expiresAt,
      resendCooldown: Math.floor(RESEND_COOLDOWN_MS / 1000),
      senderEmail: SENDER_GMAIL,
      demoMode: emailResult.demoMode,
      // Only include demo OTP in development/demo mode when SMTP password is not set
      demoOtp: !isProduction ? otp : undefined,
      message: emailResult.demoMode
        ? 'Verification code generated (simulated delivery).'
        : `Verification code sent to ${cleanEmail}`
    });
  } catch (error: any) {
    console.error('Error in /api/otp/send:', error);
    return res.status(500).json({
      error: 'Failed to process verification code',
      message: error?.message
    });
  }
}
