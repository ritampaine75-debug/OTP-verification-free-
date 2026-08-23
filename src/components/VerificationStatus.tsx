import React from 'react';
import { CheckCircle2, ShieldCheck, Mail, Calendar, ArrowRight, Lock } from 'lucide-react';

interface VerificationStatusProps {
  email: string;
  verifiedAt: number;
  onReset: () => void;
}

export const VerificationStatus: React.FC<VerificationStatusProps> = ({
  email,
  verifiedAt,
  onReset
}) => {
  const formattedDate = new Date(verifiedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  });

  return (
    <div id="verification-status-container" className="w-full text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
        <CheckCircle2 className="h-9 w-9" />
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 mb-3">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Email Successfully Verified</span>
      </div>

      <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
        Verification Complete
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        The email address has been authenticated via one-time passcode.
      </p>

      {/* Verified Email Card */}
      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Verified Identity
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              <Lock className="h-3 w-3" />
              <span>Record Purged</span>
            </span>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500 font-medium">Email Account</div>
              <div className="text-sm font-semibold text-slate-900 truncate">{email}</div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 shrink-0">
              <Calendar className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500 font-medium">Verified Timestamp</div>
              <div className="text-xs font-semibold text-slate-800">{formattedDate}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Security Details Checklist */}
      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 text-left text-xs text-slate-600 space-y-2">
        <div className="flex items-center gap-2 text-slate-700 font-medium">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>Single-use OTP was securely deleted from Firebase</span>
        </div>
        <div className="flex items-center gap-2 text-slate-700 font-medium">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>Code expired after 5 minutes & cannot be reused</span>
        </div>
      </div>

      <button
        id="verify-another-email-button"
        type="button"
        onClick={onReset}
        className="mt-6 group flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3.5 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
      >
        <span>Verify Another Email</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  );
};
