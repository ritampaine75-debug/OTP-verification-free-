import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import {
  SENDER_GMAIL,
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
} from '../src/server/otpEngine';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = req.url || '';

  // 1. System Status
  if (url.endsWith('/status') || url === '/api/status') {
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

  // 2. Send OTP Endpoint
  if ((url.endsWith('/otp/send') || url.includes('/api/otp/send')) && req.method === 'POST') {
    try {
      const { email } = req.body || {};
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(String(email).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address.'
        });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      await invalidatePreviousOtpsForEmail(normalizedEmail);

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

      await saveOtpToFirebase(record);
      const emailResult = await sendOtpEmail(normalizedEmail, otp);

      return res.status(200).json({
        success: true,
        verificationId,
        expiresAt,
        demoMode: emailResult.demoMode,
        demoOtp: emailResult.demoMode ? otp : undefined,
        message: emailResult.demoMode
          ? 'Verification code generated (Demo mode: Gmail SMTP credentials pending in environment variables).'
          : 'A 6-digit verification code has been sent to your Gmail inbox.'
      });
    } catch (error: any) {
      console.error('Error sending OTP on Vercel:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to process verification request. Please try again.'
      });
    }
  }

  // 3. Verify OTP Endpoint
  if ((url.endsWith('/otp/verify') || url.includes('/api/otp/verify')) && req.method === 'POST') {
    try {
      const { verificationId, email, otp } = req.body || {};

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

      if (now >= record.expiresAt) {
        await deleteOtpFromFirebase(String(verificationId));
        return res.status(400).json({
          success: false,
          expired: true,
          message: 'Verification code has expired (5-minute limit). Please request a new code.'
        });
      }

      const nextAttempts = (record.attempts || 0) + 1;
      if (nextAttempts > MAX_ATTEMPTS) {
        await deleteOtpFromFirebase(String(verificationId));
        return res.status(429).json({
          success: false,
          locked: true,
          message: 'Maximum verification attempts exceeded. Session locked for security. Please request a new code.'
        });
      }

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

      // Success: delete record immediately
      await deleteOtpFromFirebase(String(verificationId));

      return res.status(200).json({
        success: true,
        verified: true,
        email: normalizedEmail,
        verifiedAt: now,
        message: 'Email address verified successfully!'
      });
    } catch (error: any) {
      console.error('Error verifying OTP on Vercel:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred during verification. Please try again.'
      });
    }
  }

  // 4. Resend OTP Endpoint
  if ((url.endsWith('/otp/resend') || url.includes('/api/otp/resend')) && req.method === 'POST') {
    try {
      const { verificationId, email } = req.body || {};
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
      console.error('Error resending OTP on Vercel:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to resend verification code. Please try again.'
      });
    }
  }

  return res.status(404).json({ error: 'Endpoint not found' });
}
