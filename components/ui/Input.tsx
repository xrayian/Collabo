'use client';

/**
 * components/ui/Input.tsx
 * Clean form input with label and error display.
 */
import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  monospace?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, monospace, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium uppercase tracking-wider text-zinc-600">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={twMerge(
            clsx(
              'w-full px-3.5 py-2.5 rounded-lg border bg-white text-zinc-900 placeholder-zinc-400 text-sm shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1',
              error
                ? 'border-red-500 focus:border-red-500 focus:ring-red-400'
                : 'border-zinc-300 focus:border-zinc-900 focus:ring-zinc-900/20',
              monospace && 'font-mono uppercase tracking-widest text-center text-lg font-bold',
              className
            )
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        {!error && helperText && <p className="text-xs text-zinc-500">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
