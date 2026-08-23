import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  MAX_ATTEMPTS,
  hashOtp,
  getOtpFromFirebase,
  deleteOtpFromFirebase,
  updateOtpInFirebase
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
    const { verificationId, email, otp } = body || {};

    if (!verificationId || !email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Verification ID, email, and 6-digit code are required.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const record = await getOtpFromFirebase(String(verificationId));

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
      await deleteOtpFromFirebase(String(verificationId));
      return res.status(400).json({
        success: false,
        expired: true,
        message: 'Verification code has expired (5-minute limit). Please request a new code.'
      });
    }

    // Attempt Limit Verification (Max 5 attempts)
    const nextAttempts = (record.attempts || 0) + 1;
    if (nextAttempts > MAX_ATTEMPTS) {
      await deleteOtpFromFirebase(String(verificationId));
      return res.status(429).json({
        success: false,
        locked: true,
        message: 'Maximum verification attempts exceeded. Session locked for security. Please request a new code.'
      });
    }

    // Compare Hash of Submitted OTP
    const submittedHash = hashOtp(String(otp).trim());
    if (submittedHash !== record.otpHash) {
      await updateOtpInFirebase(String(verificationId), { attempts: nextAttempts });
      const remainingAttempts = MAX_ATTEMPTS - nextAttempts;
      return res.status(400).json({
        success: false,
        remainingAttempts,
        message: remainingAttempts > 0
          ? `Incorrect code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`
          : 'Maximum attempts reached. Session has been locked.'
      });
    }

    // Successful Verification: delete record immediately
    await deleteOtpFromFirebase(String(verificationId));

    return res.status(200).json({
      success: true,
      verified: true,
      email: normalizedEmail,
      verifiedAt: now,
      message: 'Email address verified successfully!'
    });
  } catch (error: any) {
    console.error('Error in /api/otp/verify:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during verification. Please try again.'
    });
  }
}
