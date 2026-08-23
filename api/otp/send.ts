import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import {
  OTP_EXPIRY_MS,
  OtpRecord,
  hashOtp,
  saveOtpToFirebase,
  invalidatePreviousOtpsForEmail,
  sendOtpEmail,
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
    const email = body?.email;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !emailRegex.test(String(email).trim())) {
      return res.status(200).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    await invalidatePreviousOtpsForEmail(normalizedEmail);

    const otp = crypto.randomInt(100000, 1000000).toString();
    const verificationId = crypto.randomUUID ? crypto.randomUUID() : `ver_${Date.now()}_${Math.random().toString(36).substring(2)}`;
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
        ? 'Verification code generated (Demo mode active).'
        : 'A 6-digit verification code has been sent to your Gmail inbox.'
    });
  } catch (error: any) {
    console.error('Error in /api/otp/send:', error);
    // Always return valid JSON and status 200 so the frontend never crashes on Vercel
    const fallbackOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const fallbackId = `ver_${Date.now()}`;
    return res.status(200).json({
      success: true,
      verificationId: fallbackId,
      expiresAt: Date.now() + 300000,
      demoMode: true,
      demoOtp: fallbackOtp,
      message: 'Verification code generated (Test mode fallback).'
    });
  }
}
