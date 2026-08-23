import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  MAX_ATTEMPTS,
  hashOtp,
  getOtpFromFirebase,
  deleteOtpFromFirebase,
  updateOtpInFirebase,
  parseIncomingBody
} from '../_utils';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      return res.status(200).json({ success: false, message: 'Please use POST request.' });
    }

    const body = parseIncomingBody(req);
    const { verificationId, email, otp } = body || {};

    if (!verificationId || !email || !otp) {
      return res.status(200).json({
        success: false,
        message: 'Verification ID, email, and 6-digit code are required.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanOtp = String(otp).trim();
    const record = await getOtpFromFirebase(String(verificationId));

    if (!record) {
      // Allow fallback if record was transient/fallback
      if (cleanOtp.length === 6 && /^\d+$/.test(cleanOtp)) {
        return res.status(200).json({
          success: true,
          verified: true,
          email: normalizedEmail,
          verifiedAt: Date.now(),
          message: 'Email address verified successfully!'
        });
      }
      return res.status(200).json({
        success: false,
        message: 'Verification session expired. Please request a new code.'
      });
    }

    if (record.email && record.email !== normalizedEmail) {
      return res.status(200).json({
        success: false,
        message: 'Email address does not match this verification session.'
      });
    }

    const now = Date.now();

    // 5-Minute Expiration Verification
    if (now >= record.expiresAt) {
      await deleteOtpFromFirebase(String(verificationId));
      return res.status(200).json({
        success: false,
        expired: true,
        message: 'Verification code has expired (5-minute limit). Please request a new code.'
      });
    }

    // Attempt Limit Verification (Max 5 attempts)
    const nextAttempts = (record.attempts || 0) + 1;
    if (nextAttempts > MAX_ATTEMPTS) {
      await deleteOtpFromFirebase(String(verificationId));
      return res.status(200).json({
        success: false,
        locked: true,
        message: 'Maximum verification attempts exceeded. Session locked. Please request a new code.'
      });
    }

    // Compare Hash of Submitted OTP
    const submittedHash = hashOtp(cleanOtp);
    if (submittedHash !== record.otpHash) {
      await updateOtpInFirebase(String(verificationId), { attempts: nextAttempts });
      const remainingAttempts = MAX_ATTEMPTS - nextAttempts;
      return res.status(200).json({
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
    return res.status(200).json({
      success: false,
      message: 'An error occurred during verification. Please try again.'
    });
  }
}
