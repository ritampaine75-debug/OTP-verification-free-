import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import {
  OTP_EXPIRY_MS,
  OtpRecord,
  hashOtp,
  saveOtpToFirebase,
  invalidatePreviousOtpsForEmail,
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
    const email = body?.email;
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
        ? 'Verification code generated (Demo mode: Gmail App Password not yet configured).'
        : 'A 6-digit verification code has been sent to your Gmail inbox.'
    });
  } catch (error: any) {
    console.error('Error in /api/otp/send:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process verification request. Please try again.'
    });
  }
}
