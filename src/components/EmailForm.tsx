import React, { useState } from 'react';
import { Mail, ArrowRight, ShieldCheck, Sparkles, Loader2, AlertCircle } from 'lucide-react';

interface EmailFormProps {
  onSubmit: (email: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  onClearError: () => void;
  smtpConfigured?: boolean;
}

export const EmailForm: React.FC<EmailFormProps> = ({
  onSubmit,
  isLoading,
  error,
  onClearError,
  smtpConfigured = false
}) => {
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState('');

  const validateEmail = (val: string) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(val.trim());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    onClearError();

    if (!email.trim()) {
      setLocalError('Please enter your email address.');
      return;
    }

    if (!validateEmail(email)) {
      setLocalError('Please enter a valid email address (e.g. name@gmail.com).');
      return;
    }

    await onSubmit(email.trim());
  };

  const displayError = localError || error;

  return (
    <div id="email-form-container" className="w-full">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-8 ring-blue-50/50">
          <Mail className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Gmail OTP Verification
        </h2>
        <p className="mt-1.5 text-sm text-slate-600">
          Enter your email to receive a secure 6-digit one-time code.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
            Email Address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
              <Mail className="h-5 w-5" />
            </div>
            <input
              id="email-input"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (displayError) {
                  setLocalError('');
                  onClearError();
                }
              }}
              disabled={isLoading}
              placeholder="you@gmail.com"
              autoComplete="email"
              autoFocus
              className={`block w-full rounded-xl border bg-slate-50/50 py-3 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                displayError
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
              }`}
            />
          </div>
          {displayError && (
            <div id="email-error-message" className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{displayError}</span>
            </div>
          )}
        </div>

        <button
          id="send-otp-button"
          type="submit"
          disabled={isLoading || !email}
          className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Sending Code...</span>
            </>
          ) : (
            <>
              <span>Send Verification Code</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50/80 p-3.5 text-xs text-slate-600">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-slate-800">Security Guarantee:</span> Codes are valid for 5 minutes and single-use only. OTPs are cryptographically hashed on the server and never stored in plain text.
          </div>
        </div>
      </div>
    </div>
  );
};
