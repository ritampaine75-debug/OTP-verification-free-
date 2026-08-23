import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import {
  OTP_EXPIRY_MS,
  RESEND_COOLDOWN_MS,
  OtpRecord,
  hashOtp,
  saveOtpToFirebase,
  getOtpFromFirebase,
  deleteOtpFromFirebase,
  sendOtpEmail
} from '../../src/server/otpEngine';

function parseBody(req: VercelRequest): any {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const body = parseBody(req);
    const { verificationId, email } = body || {};

    if (!verificationId || !email) {
      return res.status(400).json({
        success: false,
        message: 'Verification ID and email are required to resend.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const oldRecord = await getOtpFromFirebase(String(verificationId));

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
      await deleteOtpFromFirebase(String(verificationId));
    }

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
    console.error('Error in /api/otp/resend:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend verification code. Please try again.'
    });
  }
}
