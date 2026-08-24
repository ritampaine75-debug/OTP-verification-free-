import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getOtpFromFirebase,
  saveOtpToFirebase,
  sendOtpEmail,
  generateSecureOtp,
  hashOtp,
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
    const { verificationId } = req.body || {};

    if (!verificationId) {
      return res.status(400).json({ error: 'Verification ID is required' });
    }

    const record = await getOtpFromFirebase(verificationId);

    if (!record) {
      return res.status(404).json({
        error: 'Verification session expired. Please enter your email again.',
        code: 'SESSION_NOT_FOUND'
      });
    }

    const now = Date.now();

    // Check 60-second resend cooldown
    const timeSinceLastSend = now - (record.lastSentAt || record.createdAt);
    if (timeSinceLastSend < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - timeSinceLastSend) / 1000);
      return res.status(429).json({
        error: `Please wait ${waitSeconds} second${waitSeconds === 1 ? '' : 's'} before requesting a new code.`,
        cooldownSecondsRemaining: waitSeconds,
        code: 'COOLDOWN_ACTIVE'
      });
    }

    // Generate fresh OTP & invalidate old hash
    const newOtp = generateSecureOtp();
    const newOtpHash = hashOtp(newOtp);
    const newExpiresAt = now + OTP_EXPIRY_MS;

    const updatedRecord = {
      ...record,
      otpHash: newOtpHash,
      attempts: 0,
      expiresAt: newExpiresAt,
      resendCount: (record.resendCount || 0) + 1,
      lastSentAt: now
    };

    await saveOtpToFirebase(updatedRecord);

    const emailResult = await sendOtpEmail(record.email, newOtp);
    const isProduction = !!process.env.GMAIL_APP_PASSWORD?.trim();

    return res.status(200).json({
      success: true,
      verificationId,
      expiresAt: newExpiresAt,
      resendCooldown: Math.floor(RESEND_COOLDOWN_MS / 1000),
      senderEmail: SENDER_GMAIL,
      demoMode: emailResult.demoMode,
      demoOtp: !isProduction ? newOtp : undefined,
      message: `A new verification code has been dispatched to ${record.email}`
    });
  } catch (error: any) {
    console.error('Error in /api/otp/resend:', error);
    return res.status(500).json({
      error: 'Failed to resend verification code',
      message: error?.message
    });
  }
}
