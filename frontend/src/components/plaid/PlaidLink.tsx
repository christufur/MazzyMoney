import React, { useCallback, useState, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { plaidAPI } from '../../services/api';

interface PlaidLinkProps {
  onSuccess: () => void;
  /** When set, Link opens in update mode for this Item (a re-login, never a new connection). */
  itemId?: string;
  buttonText?: string;
  className?: string;
  variant?: 'primary' | 'secondary';
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

export const PlaidLink: React.FC<PlaidLinkProps> = ({
  onSuccess,
  itemId,
  buttonText = 'Connect Bank Account',
  className,
  variant = 'primary',
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

  // Determine button classes based on variant
  const getButtonClasses = () => {
    const baseClasses =
      'font-bold py-2 px-4 rounded-sm focus:outline-hidden focus:shadow-outline disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200';

    if (className) return `${baseClasses} ${className}`;

    if (variant === 'primary') {
      return `${baseClasses} bg-green-500 hover:bg-green-700 text-white`;
    } else {
      return `${baseClasses} bg-gray-500 hover:bg-gray-700 text-white`;
    }
  };

  const retryButton = (
    <button onClick={requestLinkToken} className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-sm">
      Try Again
    </button>
  );

  const errorBanner = error ? (
    <div className="text-sm text-red-700 bg-red-100 border border-red-400 px-3 py-2 rounded-sm mb-2">{error}</div>
  ) : null;

  if (loading) {
    return (
      <button disabled className={getButtonClasses()}>
        <span className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
          Preparing Connection...
        </span>
      </button>
    );
  }

  if (error) {
    return (
      <div className="text-left">
        {errorBanner}
        {retryButton}
      </div>
    );
  }

  if (disabled) {
    return (
      <button disabled className={getButtonClasses()}>
        {buttonText}
      </button>
    );
  }

  if (!ready || !linkToken) {
    return (
      <button disabled className={getButtonClasses()}>
        <span className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
          Preparing Connection...
        </span>
      </button>
    );
  }

  if (exchanging) {
    return (
      <button disabled className={getButtonClasses()}>
        <span className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
          Connecting Bank...
        </span>
      </button>
    );
  }

  return (
    <button onClick={handleClick} className={getButtonClasses()} disabled={disabled}>
      {buttonText}
    </button>
  );
};
