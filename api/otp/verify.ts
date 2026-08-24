import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getOtpFromFirebase,
  deleteOtpFromFirebase,
  updateOtpInFirebase,
  hashOtp,
  MAX_ATTEMPTS
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
    const { verificationId, otp } = req.body || {};

    if (!verificationId || !otp) {
      return res.status(400).json({ error: 'Verification ID and 6-digit OTP code are required' });
    }

    const cleanOtp = String(otp).trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({ error: 'OTP must be a 6-digit numeric code' });
    }

    // 1. Fetch hashed OTP record from Firebase Realtime Database
    const record = await getOtpFromFirebase(verificationId);

    if (!record) {
      return res.status(404).json({
        error: 'Verification session expired or not found. Please request a new code.',
        code: 'SESSION_NOT_FOUND'
      });
    }

    const now = Date.now();

    // 2. Check 5-minute expiration
    if (now > record.expiresAt) {
      await deleteOtpFromFirebase(verificationId);
      return res.status(410).json({
        error: 'Verification code has expired (5-minute limit exceeded). Please request a new code.',
        code: 'EXPIRED'
      });
    }

    // 3. Check 5-attempt anti brute-force lockout
    if (record.attempts >= MAX_ATTEMPTS) {
      await deleteOtpFromFirebase(verificationId);
      return res.status(429).json({
        error: 'Too many incorrect attempts. For security, this code has been revoked. Please request a new code.',
        code: 'MAX_ATTEMPTS_EXCEEDED'
      });
    }

    // 4. Verify cryptographic hash
    const inputHash = hashOtp(cleanOtp);

    if (inputHash !== record.otpHash) {
      const newAttempts = record.attempts + 1;
      await updateOtpInFirebase(verificationId, { attempts: newAttempts });

      const remainingAttempts = Math.max(0, MAX_ATTEMPTS - newAttempts);

      if (remainingAttempts === 0) {
        await deleteOtpFromFirebase(verificationId);
        return res.status(429).json({
          error: 'Invalid verification code. Maximum attempts exceeded. Please request a new code.',
          code: 'MAX_ATTEMPTS_EXCEEDED',
          attemptsRemaining: 0
        });
      }

      return res.status(400).json({
        error: `Invalid verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`,
        code: 'INVALID_OTP',
        attemptsRemaining: remainingAttempts
      });
    }

    // 5. Success: Single-use record purge (Delete from Firebase immediately)
    await deleteOtpFromFirebase(verificationId);

    return res.status(200).json({
      success: true,
      email: record.email,
      verifiedAt: now,
      message: 'Email successfully verified. Temporary OTP record has been purged.'
    });
  } catch (error: any) {
    console.error('Error in /api/otp/verify:', error);
    return res.status(500).json({
      error: 'Internal server error during verification',
      message: error?.message
    });
  }
}
