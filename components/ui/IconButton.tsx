'use client';

/**
 * components/ui/IconButton.tsx
 * Clean, accessible icon button.
 */
import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'active' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = 'default', size = 'md', label, disabled, children, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-900 disabled:opacity-40 disabled:pointer-events-none cursor-pointer';

    const variants = {
      default: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-900',
      active: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
      danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus:ring-red-500',
      ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60',
    };

    const sizes = {
      sm: 'w-8 h-8 p-1.5',
      md: 'w-10 h-10 p-2',
      lg: 'w-12 h-12 p-2.5',
    };

    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
