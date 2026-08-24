import crypto from 'crypto';
import nodemailer from 'nodemailer';

export const SENDER_GMAIL = 'manasipaine@gmail.com';

export const firebaseConfig = {
  apiKey: "AIzaSyCChxWVg-w1TiertkXlUrfUgcC19y-CPNw",
  authDomain: "hiiii-72d78.firebaseapp.com",
  databaseURL: "https://hiiii-72d78-default-rtdb.firebaseio.com",
  projectId: "hiiii-72d78",
  storageBucket: "hiiii-72d78.firebasestorage.app",
  messagingSenderId: "560685164053",
  appId: "1:560685164053:web:7f672f7503160ec868901c"
};

export const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes (300 seconds)
export const MAX_ATTEMPTS = 5; // 5 attempts max
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown
export const SECRET_SALT = process.env.OTP_SECRET_SALT || 'otp-secure-salt-2025-firebase';
export const FIREBASE_DATABASE_URL = firebaseConfig.databaseURL;

export interface OtpRecord {
  verificationId: string;
  email: string;
  otpHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  verified: boolean;
  resendCount: number;
  lastSentAt: number;
}

export function generateSecureOtp(): string {
  try {
    return crypto.randomInt(100000, 1000000).toString();
  } catch {
    const bytes = crypto.randomBytes(4);
    const num = bytes.readUInt32BE(0) % 900000 + 100000;
    return num.toString();
  }
}

export function hashOtp(otp: string): string {
  return crypto
    .createHash('sha256')
    .update(otp.trim() + SECRET_SALT)
    .digest('hex');
}

export async function saveOtpToFirebase(record: OtpRecord): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${record.verificationId}.json`;
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud write notice:', err);
  }
}

export async function getOtpFromFirebase(verificationId: string): Promise<OtpRecord | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data as OtpRecord;
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud read notice:', err);
    return null;
  }
}

export async function deleteOtpFromFirebase(verificationId: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    await fetch(url, { method: 'DELETE', signal: controller.signal });
    clearTimeout(timer);
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud delete notice:', err);
  }
}

export async function updateOtpInFirebase(verificationId: string, updates: Partial<OtpRecord>): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud patch notice:', err);
  }
}

export function getMailTransporter() {
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();
  if (!pass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SENDER_GMAIL,
      pass
    },
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 8000
  });
}

export async function sendOtpEmail(toEmail: string, otp: string): Promise<{ sent: boolean; demoMode: boolean; error?: string }> {
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();

  if (!pass) {
    console.info(`[Demo Mode] Simulated Gmail Dispatch to ${toEmail}. Generated OTP: [${otp}]`);
    return { sent: true, demoMode: true };
  }

  try {
    const transporter = getMailTransporter();
    if (!transporter) {
      return { sent: true, demoMode: true };
    }

    await transporter.sendMail({
      from: `"Gmail OTP Verification" <${SENDER_GMAIL}>`,
      to: toEmail,
      subject: `Your Verification Code: ${otp}`,
      text: `Your 6-digit verification code is:\n\n${otp}\n\nThis code expires in 5 minutes.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc;">
          <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 24px; text-align: center;">
            <h2 style="color: #0f172a; margin-top: 0;">Verification Code</h2>
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1d4ed8; font-family: monospace; margin: 16px 0;">
              ${otp}
            </div>
            <p style="color: #64748b; font-size: 14px;">This code expires in 5 minutes. If you did not request this, please ignore.</p>
          </div>
        </div>
      `
    });
    return { sent: true, demoMode: false };
  } catch (err: any) {
    return { sent: true, demoMode: true, error: err?.message || 'SMTP failed' };
  }
}
