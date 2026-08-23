/**
 * Firebase Cloud Functions for Secure Server-Side Gmail OTP Verification
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://hiiii-72d78-default-rtdb.firebaseio.com'
  });
}

const db = admin.database();
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const SECRET_SALT = process.env.OTP_SECRET_SALT || 'otp-verification-secure-salt-2025';

function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp + SECRET_SALT).digest('hex');
}

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

async function sendOtpEmail(toEmail, otp) {
  const transporter = getTransporter();
  const mailOptions = {
    from: `"Verification Security" <${process.env.GMAIL_USER || 'no-reply@verification.com'}>`,
    to: toEmail,
    subject: `Your Verification Code: ${otp}`,
    text: `Your verification code\n\n${otp}\n\nThis code expires in 5 minutes.\n\nIf you did not request this code, you can ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #0f172a; margin-top: 0; font-size: 22px; font-weight: 700;">Your verification code</h2>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
          <span style="font-family: monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #2563eb;">${otp}</span>
        </div>
        <p style="color: #475569; font-size: 15px; line-height: 1.5; margin: 0 0 16px;">This code expires in <strong>5 minutes</strong>.</p>
        <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 0;">If you did not request this code, you can safely ignore this email.</p>
      </div>
    `
  };

  if (transporter) {
    await transporter.sendMail(mailOptions);
  }
}

// 1. Send OTP Endpoint
exports.sendOtp = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
      const { email } = req.body;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email.trim())) {
        return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const otp = crypto.randomInt(100000, 1000000).toString();
      const verificationId = crypto.randomUUID();
      const otpHash = hashOtp(otp);
      const createdAt = Date.now();
      const expiresAt = createdAt + OTP_EXPIRY_MS;

      // Invalidate existing active OTPs for this email in RTDB
      const snapshot = await db.ref('otpVerifications').orderByChild('email').equalTo(normalizedEmail).once('value');
      const updates = {};
      snapshot.forEach(child => {
        updates[`otpVerifications/${child.key}`] = null; // Clean up old records
      });

      updates[`otpVerifications/${verificationId}`] = {
        email: normalizedEmail,
        otpHash,
        createdAt,
        expiresAt,
        attempts: 0,
        verified: false,
        resendCount: 0
      };

      await db.ref().update(updates);
      await sendOtpEmail(normalizedEmail, otp);

      return res.status(200).json({
        success: true,
        verificationId,
        expiresAt,
        message: 'Verification code sent successfully.'
      });
    } catch (error) {
      console.error('Error sending OTP:', error);
      return res.status(500).json({ success: false, message: 'Unable to send verification code. Please try again.' });
    }
  });
});

// 2. Verify OTP Endpoint
exports.verifyOtp = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
      const { verificationId, email, otp } = req.body;
      if (!verificationId || !email || !otp) {
        return res.status(400).json({ success: false, message: 'Verification ID, email, and 6-digit OTP are required.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const ref = db.ref(`otpVerifications/${verificationId}`);
      const snapshot = await ref.once('value');
      const record = snapshot.val();

      if (!record) {
        return res.status(404).json({ success: false, message: 'Verification session not found or already completed. Please request a new code.' });
      }

      if (record.email !== normalizedEmail) {
        return res.status(400).json({ success: false, message: 'Email address mismatch.' });
      }

      const now = Date.now();
      if (now >= record.expiresAt) {
        await ref.remove(); // Remove expired record
        return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new code.' });
      }

      const currentAttempts = (record.attempts || 0) + 1;
      if (currentAttempts > MAX_ATTEMPTS) {
        await ref.remove(); // Lock out and delete
        return res.status(429).json({ success: false, message: 'Maximum verification attempts exceeded. Session locked. Please request a new code.' });
      }

      const incomingHash = hashOtp(otp.trim());
      if (incomingHash !== record.otpHash) {
        await ref.update({ attempts: currentAttempts });
        const remaining = MAX_ATTEMPTS - currentAttempts;
        return res.status(400).json({
          success: false,
          message: remaining > 0 
            ? `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` 
            : 'Maximum verification attempts exceeded. Session locked.'
        });
      }

      // Verification successful! Immediately delete temporary record so OTP cannot be reused
      await ref.remove();

      return res.status(200).json({
        success: true,
        verified: true,
        email: normalizedEmail,
        verifiedAt: now,
        message: 'Email address verified successfully!'
      });
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return res.status(500).json({ success: false, message: 'Verification check failed. Please try again.' });
    }
  });
});

// 3. Resend OTP Endpoint
exports.resendOtp = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
      const { verificationId, email } = req.body;
      if (!verificationId || !email) {
        return res.status(400).json({ success: false, message: 'Verification ID and email are required.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const oldRef = db.ref(`otpVerifications/${verificationId}`);
      const snapshot = await oldRef.once('value');
      const record = snapshot.val();

      if (record) {
        const timeSinceCreation = Date.now() - (record.createdAt || 0);
        if (timeSinceCreation < RESEND_COOLDOWN_MS) {
          const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - timeSinceCreation) / 1000);
          return res.status(429).json({
            success: false,
            message: `Please wait ${waitSeconds}s before requesting another code.`
          });
        }
        await oldRef.remove();
      }

      const newOtp = crypto.randomInt(100000, 1000000).toString();
      const newVerificationId = crypto.randomUUID();
      const newOtpHash = hashOtp(newOtp);
      const createdAt = Date.now();
      const expiresAt = createdAt + OTP_EXPIRY_MS;

      await db.ref(`otpVerifications/${newVerificationId}`).set({
        email: normalizedEmail,
        otpHash: newOtpHash,
        createdAt,
        expiresAt,
        attempts: 0,
        verified: false,
        resendCount: ((record && record.resendCount) || 0) + 1
      });

      await sendOtpEmail(normalizedEmail, newOtp);

      return res.status(200).json({
        success: true,
        verificationId: newVerificationId,
        expiresAt,
        message: 'New verification code sent successfully.'
      });
    } catch (error) {
      console.error('Error resending OTP:', error);
      return res.status(500).json({ success: false, message: 'Unable to resend verification code. Please try again.' });
    }
  });
});
