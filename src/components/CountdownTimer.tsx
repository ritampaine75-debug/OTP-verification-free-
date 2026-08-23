import React, { useEffect, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

interface CountdownTimerProps {
  expiresAt: number;
  onExpire: () => void;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ expiresAt, onExpire }) => {
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        onExpire();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // Total 5 minutes in seconds = 300
  const totalDuration = 300;
  const progressPercent = Math.min(100, Math.max(0, (timeLeft / totalDuration) * 100));

  const isCritical = timeLeft < 60 && timeLeft > 0;
  const isExpired = timeLeft === 0;

  return (
    <div id="countdown-timer-container" className="w-full space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 font-medium text-slate-600">
          <Clock className={`h-3.5 w-3.5 ${isCritical ? 'text-amber-500 animate-pulse' : 'text-slate-400'}`} />
          <span>Code Expiration:</span>
        </span>
        <span
          id="timer-display"
          className={`font-mono font-semibold ${
            isExpired
              ? 'text-red-600'
              : isCritical
              ? 'text-amber-600 animate-pulse'
              : 'text-slate-700'
          }`}
        >
          {isExpired ? 'Expired' : formattedTime}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full transition-all duration-1000 ease-linear rounded-full ${
            isExpired
              ? 'bg-red-500'
              : isCritical
              ? 'bg-amber-500'
              : 'bg-blue-600'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {isCritical && !isExpired && (
        <p className="text-[11px] text-amber-600 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>Less than a minute remaining. Code will expire soon.</span>
        </p>
      )}
    </div>
  );
};
