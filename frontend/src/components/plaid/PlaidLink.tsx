import React, { useCallback, useState, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { plaidAPI } from '../../services/api';
import { Button } from '@/components/ui/button';

interface PlaidLinkProps {
  onSuccess: () => void;
  /** When set, Link opens in update mode for this Item (a re-login, never a new connection). */
  itemId?: string;
  buttonText?: string;
  className?: string;
  /** Maps to the shadcn Button variants; the primary (default) one is the plain ink button. */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  /** Maps to the shadcn Button sizes. */
  size?: 'default' | 'sm' | 'lg';
  disabled?: boolean;
}

const ITEM_LIMIT_MESSAGE = 'All 10 free bank connections are in use. Remove one first.';
const DUPLICATE_INSTITUTION_MESSAGE = 'This bank is already connected. Use Reconnect instead.';

const readErrorCode = (err: any): string | undefined => {
  const data = err?.response?.data;
  if (!data) return undefined;
  if (typeof data.error === 'string' && data.error !== '') return data.error;
  if (typeof data.error?.error_code === 'string') return data.error.error_code;
  return undefined;
};

const errorMessageFor = (err: any, fallback: string): string => {
  switch (readErrorCode(err)) {
    case 'ITEM_LIMIT':
      return ITEM_LIMIT_MESSAGE;
    case 'DUPLICATE_INSTITUTION':
      return DUPLICATE_INSTITUTION_MESSAGE;
    case 'ITEM_NOT_FOUND':
      return 'This bank connection no longer exists. Refresh the page.';
    default:
      return fallback;
  }
};

/** The old "primary"/"secondary" names, mapped onto the shadcn variants. */
const buttonVariant = (variant: PlaidLinkProps['variant']) => {
  switch (variant) {
    case 'secondary':
      return 'secondary' as const;
    case 'outline':
      return 'outline' as const;
    case 'ghost':
      return 'ghost' as const;
    default:
      return 'default' as const;
  }
};

export const PlaidLink: React.FC<PlaidLinkProps> = ({
  onSuccess,
  itemId,
  buttonText = 'Connect bank',
  className,
  variant = 'primary',
  size = 'default',
  disabled = false,
}) => {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const isUpdateMode = Boolean(itemId);

  const requestLinkToken = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setLinkToken(null);
      const response = await plaidAPI.createLinkToken(itemId);
      setLinkToken(response.link_token);
    } catch (err: any) {
      setError(errorMessageFor(err, 'Failed to initialize bank connection. Try again.'));
      console.error('Link token error:', err);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  // Request a link token on mount, and again whenever the Item changes.
  // A disabled button (the free Item limit is reached) must not ask for a token.
  useEffect(() => {
    if (disabled) return;
    requestLinkToken();
  }, [requestLinkToken, disabled]);

  const onSuccessCallback = useCallback(
    async (publicToken: string) => {
      // Update mode refreshes the existing Item, so there is no public token to exchange.
      if (isUpdateMode) {
        onSuccess();
        return;
      }

      try {
        setExchanging(true);
        setError(null);
        await plaidAPI.exchangePublicToken(publicToken);
        onSuccess();
      } catch (err: any) {
        setError(errorMessageFor(err, 'Failed to connect bank account.'));
        console.error('Token exchange error:', err);
      } finally {
        setExchanging(false);
      }
    },
    [isUpdateMode, onSuccess]
  );

  const onExitCallback = useCallback((err: any) => {
    if (err) {
      console.log('Plaid Link exit error:', err);
      if (err.error_code === 'USER_EXITED') {
        // User cancelled - this is normal, don't show error
        return;
      }
      setError('Bank connection was cancelled or failed.');
    }
  }, []);

  const config = {
    token: linkToken,
    onSuccess: onSuccessCallback,
    onExit: onExitCallback,
  };

  const { open, ready } = usePlaidLink(config);

  const handleClick = useCallback(() => {
    setError(null);
    open();
  }, [open]);

  const resolvedVariant = buttonVariant(variant);

  if (error) {
    return (
      <div className={className}>
        <p role="alert" className="text-sm text-terra">
          {error}
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={requestLinkToken}>
          Try again
        </Button>
      </div>
    );
  }

  // A disabled button never asked for a token, so it keeps its own label.
  const waiting = !disabled && (loading || exchanging || !ready || !linkToken);
  const label = disabled
    ? buttonText
    : loading
      ? 'Preparing connection…'
      : exchanging
        ? 'Connecting bank…'
        : buttonText;

  return (
    <Button
      variant={resolvedVariant}
      size={size}
      className={className}
      onClick={handleClick}
      disabled={disabled || waiting}
      aria-busy={waiting || undefined}
    >
      {label}
    </Button>
  );
};
