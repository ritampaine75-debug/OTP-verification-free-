import React, { useState, useRef, useEffect } from 'react';
import { KeyRound, RotateCcw, ArrowLeft, CheckCircle2, AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { CountdownTimer } from './CountdownTimer';

interface OtpFormProps {
  email: string;
  verificationId: string;
  expiresAt: number;
  onVerify: (otp: string) => Promise<void>;
  onResend: () => Promise<void>;
  onChangeEmail: () => void;
  isLoading: boolean;
  isResending: boolean;
  error: string | null;
  onClearError: () => void;
  demoOtp?: string;
}

export const OtpForm: React.FC<OtpFormProps> = ({
  email,
  verificationId,
  expiresAt,
  onVerify,
  onResend,
  onChangeEmail,
  isLoading,
  isResending,
  error,
  onClearError,
  demoOtp
}) => {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [isExpired, setIsExpired] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus the first input on initial mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Handle single digit change
  const handleDigitChange = (index: number, value: string) => {
    onClearError();
    const cleanVal = value.replace(/\D/g, '');

    if (!cleanVal) {
      const newDigits = [...digits];
      newDigits[index] = '';
      setDigits(newDigits);
      return;
    }

    // If pasted or typed multiple digits
    if (cleanVal.length > 1) {
      const pastedDigits = cleanVal.slice(0, 6).split('');
      const newDigits = [...digits];
      pastedDigits.forEach((digit, i) => {
        if (index + i < 6) {
          newDigits[index + i] = digit;
        }
      });
      setDigits(newDigits);
      const nextIndex = Math.min(index + pastedDigits.length, 5);
      inputRefs.current[nextIndex]?.focus();
      return;
    }

    // Single digit input
    const newDigits = [...digits];
    newDigits[index] = cleanVal;
    setDigits(newDigits);

    // Auto-advance to next input
    if (index < 5 && cleanVal) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Handle Backspace and arrow navigation
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Handle Paste event
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    onClearError();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData) {
      const newDigits = [...digits];
      pastedData.split('').forEach((char, i) => {
        if (i < 6) newDigits[i] = char;
      });
      setDigits(newDigits);
      const nextFocus = Math.min(pastedData.length, 5);
      inputRefs.current[nextFocus]?.focus();
    }
  };

  const fullOtp = digits.join('');
  const isComplete = fullOtp.length === 6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isComplete || isLoading || isExpired) return;
    await onVerify(fullOtp);
  };

  const handleResendClick = async () => {
    if (resendCooldown > 0 || isResending) return;
    setDigits(['', '', '', '', '', '']);
    setIsExpired(false);
    onClearError();
    await onResend();
    setResendCooldown(60);
    inputRefs.current[0]?.focus();
  };

  return (
    <div id="otp-form-container" className="w-full">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-8 ring-blue-50/50">
          <KeyRound className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Enter Verification Code
        </h2>
        <p className="mt-1.5 text-sm text-slate-600">
          We sent a 6-digit code to{' '}
          <span className="font-semibold text-slate-900 break-all">{email}</span>
        </p>
      </div>

      {demoOtp && (
        <div id="demo-mode-helper" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Local Demo Code:</span>
            <span className="font-mono font-bold text-amber-900 tracking-wider bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
              {demoOtp}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-amber-700">
            Set GMAIL_USER & GMAIL_APP_PASSWORD in .env for production Gmail SMTP delivery.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 6-Digit OTP Inputs */}
        <div>
          <div className="flex justify-between gap-2 sm:gap-2.5">
            {digits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => { inputRefs.current[idx] = el; }}
                id={`otp-input-${idx}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                onPaste={handlePaste}
                disabled={isLoading || isExpired}
                className={`h-13 w-full text-center text-xl font-bold rounded-xl border bg-slate-50/50 transition focus:bg-white focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  error
                    ? 'border-red-300 text-red-600 focus:border-red-500 focus:ring-red-200'
                    : digit
                    ? 'border-blue-500 bg-blue-50/20 text-slate-900 focus:border-blue-600 focus:ring-blue-100'
                    : 'border-slate-200 text-slate-900 focus:border-blue-500 focus:ring-blue-100'
                }`}
              />
            ))}
          </div>

          {error && (
            <div id="otp-error-message" className="mt-3 flex items-start gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* 5-Minute Countdown Timer */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
          <CountdownTimer
            expiresAt={expiresAt}
            onExpire={() => setIsExpired(true)}
          />
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          <button
            id="verify-otp-button"
            type="submit"
            disabled={!isComplete || isLoading || isExpired}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 px-4 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Verifying Code...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Verify OTP</span>
              </>
            )}
          </button>

          <div className="flex items-center justify-between pt-2 text-xs">
            <button
              id="change-email-button"
              type="button"
              onClick={onChangeEmail}
              disabled={isLoading}
              className="flex items-center gap-1 font-medium text-slate-500 hover:text-slate-800 transition disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Change Email</span>
            </button>

            <button
              id="resend-otp-button"
              type="button"
              onClick={handleResendClick}
              disabled={resendCooldown > 0 || isResending || isLoading}
              className="flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed transition"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${isResending ? 'animate-spin' : ''}`} />
              <span>
                {isResending
                  ? 'Resending...'
                  : resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : 'Resend Code'}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
