import React, { useState, useEffect } from 'react';
import { EmailForm } from './components/EmailForm';
import { OtpForm } from './components/OtpForm';
import { VerificationStatus } from './components/VerificationStatus';
import { Shield, KeyRound, Server, CheckCircle2, Info, ExternalLink } from 'lucide-react';

export default function App() {
  const [step, setStep] = useState<'email' | 'otp' | 'verified'>('email');
  const [email, setEmail] = useState<string>('');
  const [verificationId, setVerificationId] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [demoOtp, setDemoOtp] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isResending, setIsResending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<number>(0);
  const [smtpStatus, setSmtpStatus] = useState<{ gmailConfigured: boolean; senderEmail: string | null } | null>(null);
  const [showConfigGuide, setShowConfigGuide] = useState<boolean>(false);

  // Check system & SMTP status on mount
  useEffect(() => {
    fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        setSmtpStatus({
          gmailConfigured: data.gmailConfigured,
          senderEmail: data.senderEmail
        });
      })
      .catch((err) => console.warn('Could not fetch server status:', err));
  }, []);

  // Handler: Send OTP
  const handleSendOtp = async (targetEmail: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || 'Failed to send verification code.');
        return;
      }

      setEmail(targetEmail);
      setVerificationId(data.verificationId);
      setExpiresAt(data.expiresAt);
      setDemoOtp(data.demoOtp);
      setStep('otp');
    } catch (err: any) {
      console.error('Send OTP error:', err);
      setError('Network or server error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Verify OTP
  const handleVerifyOtp = async (otp: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationId,
          email,
          otp
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || 'Verification failed. Please check the code and try again.');
        return;
      }

      setVerifiedAt(data.verifiedAt || Date.now());
      setStep('verified');
    } catch (err: any) {
      console.error('Verify OTP error:', err);
      setError('An error occurred during verification. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Resend OTP
  const handleResendOtp = async () => {
    setIsResending(true);
    setError(null);

    try {
      const response = await fetch('/api/otp/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationId,
          email
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || 'Unable to resend code at this time.');
        return;
      }

      setVerificationId(data.verificationId);
      setExpiresAt(data.expiresAt);
      setDemoOtp(data.demoOtp);
    } catch (err: any) {
      console.error('Resend OTP error:', err);
      setError('Could not resend verification code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  // Reset to initial state
  const handleReset = () => {
    setStep('email');
    setEmail('');
    setVerificationId('');
    setExpiresAt(0);
    setDemoOtp(undefined);
    setError(null);
    setVerifiedAt(0);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between selection:bg-blue-500 selection:text-white">
      {/* Top Navbar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-600/30">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">
                Gmail OTP Service
              </h1>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Firebase Realtime Database & Node SMTP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="toggle-guide-button"
              type="button"
              onClick={() => setShowConfigGuide(!showConfigGuide)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition"
            >
              <Info className="h-3.5 w-3.5 text-blue-600" />
              <span>Setup Guide</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-md">
          {/* Main Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            {step === 'email' && (
              <EmailForm
                onSubmit={handleSendOtp}
                isLoading={isLoading}
                error={error}
                onClearError={() => setError(null)}
                smtpConfigured={smtpStatus?.gmailConfigured}
              />
            )}

            {step === 'otp' && (
              <OtpForm
                email={email}
                verificationId={verificationId}
                expiresAt={expiresAt}
                onVerify={handleVerifyOtp}
                onResend={handleResendOtp}
                onChangeEmail={() => {
                  setError(null);
                  setStep('email');
                }}
                isLoading={isLoading}
                isResending={isResending}
                error={error}
                onClearError={() => setError(null)}
                demoOtp={demoOtp}
              />
            )}

            {step === 'verified' && (
              <VerificationStatus
                email={email}
                verifiedAt={verifiedAt}
                onReset={handleReset}
              />
            )}
          </div>

          {/* Security Features Badge List */}
          <div className="mt-6 grid grid-cols-3 gap-2 text-center text-[11px] text-slate-500">
            <div className="rounded-xl border border-slate-200/80 bg-white/60 p-2.5 shadow-2xs">
              <KeyRound className="h-4 w-4 mx-auto mb-1 text-blue-600" />
              <span className="font-semibold text-slate-700 block">SHA-256</span>
              <span>Hashed OTP</span>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/60 p-2.5 shadow-2xs">
              <Shield className="h-4 w-4 mx-auto mb-1 text-emerald-600" />
              <span className="font-semibold text-slate-700 block">5 Minutes</span>
              <span>Auto-Expiry</span>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/60 p-2.5 shadow-2xs">
              <Server className="h-4 w-4 mx-auto mb-1 text-purple-600" />
              <span className="font-semibold text-slate-700 block">Max 5 Tries</span>
              <span>Brute Protection</span>
            </div>
          </div>
        </div>
      </main>

      {/* Setup Guide Modal / Drawer */}
      {showConfigGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Info className="h-5 w-5 text-blue-600" />
                Gmail SMTP & Firebase Setup Instructions
              </h3>
              <button
                type="button"
                onClick={() => setShowConfigGuide(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <div>
                <h4 className="font-bold text-slate-900 mb-1">1. Gmail 2-Step Verification & App Password</h4>
                <p>To enable real emails through Gmail SMTP without exposing your primary Google account password:</p>
                <ol className="list-decimal pl-4 mt-1 space-y-1 text-slate-700">
                  <li>Go to your Google Account (<a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">Google Security <ExternalLink className="h-3 w-3" /></a>).</li>
                  <li>Enable <strong>2-Step Verification</strong>.</li>
                  <li>Search for <strong>"App passwords"</strong> in the security search bar.</li>
                  <li>Create an app named <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">OTP Verification</code> and copy the 16-character password.</li>
                  <li>Add to your <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code> or Secrets: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">GMAIL_USER</code> and <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">GMAIL_APP_PASSWORD</code>.</li>
                </ol>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-1">2. Firebase Realtime Database</h4>
                <p>Firebase Realtime Database handles temporary OTP state tracking under <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">otpVerifications/</code>:</p>
                <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-700">
                  <li>Security rules in <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">database.rules.json</code> restrict public read/writes.</li>
                  <li>All OTP creation, SHA-256 hash checks, and expiration validation occur server-side.</li>
                  <li>Temporary verification records are immediately deleted upon successful verification.</li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 mb-1">3. GitHub Actions & Secrets Deployment</h4>
                <p>The repository is pre-configured with <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">.github/workflows/deploy.yml</code>.</p>
                <p className="mt-1">Add repository secrets in GitHub under <strong>Settings &gt; Secrets and variables &gt; Actions</strong>:</p>
                <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-700 font-mono text-[11px]">
                  <li>GMAIL_USER</li>
                  <li>GMAIL_APP_PASSWORD</li>
                  <li>FIREBASE_PROJECT_ID</li>
                  <li>FIREBASE_SERVICE_ACCOUNT (or FIREBASE_TOKEN)</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowConfigGuide(false)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>React + Vite + Firebase Realtime Database + Nodemailer</span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>Secure Server-Side Cryptographic OTP Engine</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
