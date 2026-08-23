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

export const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
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
}

// In-memory fallback
export const memoryOtpStore = new Map<string, OtpRecord>();

export function hashOtp(otp: string): string {
  try {
    return crypto.createHash('sha256').update(otp.trim() + SECRET_SALT).digest('hex');
  } catch {
    return Buffer.from(otp.trim() + SECRET_SALT).toString('base64');
  }
}

export async function saveOtpToFirebase(record: OtpRecord): Promise<void> {
  memoryOtpStore.set(record.verificationId, record);
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
    console.warn('[Firebase RTDB] Cloud write warning (persisted in memory):', err);
  }
}

export async function getOtpFromFirebase(verificationId: string): Promise<OtpRecord | null> {
  if (memoryOtpStore.has(verificationId)) {
    return memoryOtpStore.get(verificationId)!;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data) {
      memoryOtpStore.set(verificationId, data);
      return data as OtpRecord;
    }
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud read warning:', err);
  }
  return null;
}

export async function deleteOtpFromFirebase(verificationId: string): Promise<void> {
  memoryOtpStore.delete(verificationId);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${verificationId}.json`;
    await fetch(url, { method: 'DELETE', signal: controller.signal });
    clearTimeout(timer);
  } catch (err) {
    console.warn('[Firebase RTDB] Cloud delete warning:', err);
  }
}

export async function updateOtpInFirebase(verificationId: string, updates: Partial<OtpRecord>): Promise<void> {
  const existing = memoryOtpStore.get(verificationId);
  if (existing) {
    Object.assign(existing, updates);
  }
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
    console.warn('[Firebase RTDB] Cloud patch warning:', err);
  }
}

export async function invalidatePreviousOtpsForEmail(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  for (const [id, rec] of memoryOtpStore.entries()) {
    if (rec.email === normalizedEmail) {
      memoryOtpStore.delete(id);
      try {
        const url = `${FIREBASE_DATABASE_URL}/otpVerifications/${id}.json`;
        fetch(url, { method: 'DELETE' }).catch(() => {});
      } catch {
        // ignore
      }
    }
  }
}

export function parseIncomingBody(req: any): any {
  if (!req) return {};
  if (req.body) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
  }
  return {};
}

export async function sendOtpEmail(toEmail: string, otp: string): Promise<{ sent: boolean; demoMode: boolean; error?: string }> {
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();

  if (!pass) {
    console.info(`[Demo Mode] No GMAIL_APP_PASSWORD set. Generated OTP: [${otp}] for ${toEmail}`);
    return {
      sent: true,
      demoMode: true
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: SENDER_GMAIL,
        pass
      },
      connectionTimeout: 6000,
      greetingTimeout: 6000,
      socketTimeout: 8000
    });

    await transporter.sendMail({
      from: `"Verification Security" <${SENDER_GMAIL}>`,
      to: toEmail,
      subject: `Your Verification Code: ${otp}`,
      text: `Your verification code\n\n${otp}\n\nThis code expires in 5 minutes.\n\nIf you did not request this code, you can ignore this email.`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; }
            .card { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .header { text-align: center; margin-bottom: 24px; }
            .title { color: #0f172a; font-size: 22px; font-weight: 700; margin: 0 0 8px 0; }
            .subtitle { color: #64748b; font-size: 14px; margin: 0; }
            .code-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
            .code { font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #2563eb; margin: 0; }
            .expiry { color: #475569; font-size: 14px; margin-bottom: 20px; line-height: 1.6; }
            .footer { border-top: 1px solid #f1f5f9; padding-top: 16px; color: #94a3b8; font-size: 12px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1 class="title">Your verification code</h1>
              <p class="subtitle">Please use the code below to complete your verification</p>
            </div>
            <div class="code-box">
              <div class="code">${otp}</div>
            </div>
            <p class="expiry">This code expires in <strong>5 minutes</strong>. For your security, never share this code with anyone.</p>
            <div class="footer">
              <p>If you did not request this code, you can safely ignore this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    return { sent: true, demoMode: false };
  } catch (err: any) {
    console.error('SMTP Delivery error (fallback to demo mode):', err?.message || err);
    return {
      sent: true,
      demoMode: true,
      error: err?.message || 'SMTP failed'
    };
  }
}
