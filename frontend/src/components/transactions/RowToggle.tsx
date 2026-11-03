import React from 'react';
import { cn } from '@/lib/utils';

interface RowToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A quiet switch for a row-level flag. The dot fills in sage when the flag is on,
 * so a review card says "Transfer" or "Hide from totals" as a state, not a form.
 */
export const RowToggle: React.FC<RowToggleProps> = ({ label, checked, onChange, disabled, className }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border border-rule bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-ink disabled:opacity-50',
      checked && 'border-sage text-sage-ink hover:text-sage-ink',
      className
    )}
  >
    <span aria-hidden className={cn('size-1.5 rounded-full bg-rule', checked && 'bg-sage')} />
    {label}
  </button>
);
