import type { VercelRequest, VercelResponse } from '@vercel/node';
import statusHandler from './status';
import sendHandler from './otp/send';
import verifyHandler from './otp/verify';
import resendHandler from './otp/resend';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const url = req.url || '';

    if (url.includes('/api/status') || url.endsWith('/status')) {
      return statusHandler(req, res);
    }
    if (url.includes('/api/otp/send') || url.endsWith('/send')) {
      return sendHandler(req, res);
    }
    if (url.includes('/api/otp/verify') || url.endsWith('/verify')) {
      return verifyHandler(req, res);
    }
    if (url.includes('/api/otp/resend') || url.endsWith('/resend')) {
      return resendHandler(req, res);
    }

    return res.status(200).json({ status: 'ok', message: 'Gmail OTP API Active' });
  } catch (error: any) {
    return res.status(200).json({ status: 'ok', error: error?.message || 'Serverless gateway active' });
  }
}
