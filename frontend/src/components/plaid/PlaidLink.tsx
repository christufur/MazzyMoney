import React, { useCallback, useState, useEffect } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { plaidAPI } from '../../services/api';

interface PlaidLinkProps {
  onSuccess: () => void;
  buttonText?: string;
  className?: string;
  variant?: 'primary' | 'secondary';
}

export const PlaidLink: React.FC<PlaidLinkProps> = ({ 
  onSuccess, 
  buttonText = "Connect Bank Account",
  className,
  variant = 'primary'
}) => {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);

  // Create link token when component mounts
  useEffect(() => {
    const createLinkToken = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await plaidAPI.createLinkToken();
        setLinkToken(response.link_token);
      } catch (err: any) {
        setError('Failed to initialize bank connection');
        console.error('Link token error:', err);
      } finally {
        setLoading(false);
      }
    };

    createLinkToken();
  }, []);

  const onSuccessCallback = useCallback(async (public_token: string, metadata: any) => {
    try {
      setExchanging(true);
      const response = await plaidAPI.exchangePublicToken(public_token);
      
      // Show success message with institution name if available
      if (response.institution_name) {
        console.log(`Successfully connected to ${response.institution_name}!`);
      }
      
      onSuccess();
    } catch (err: any) {
      setError('Failed to connect bank account');
      console.error('Token exchange error:', err);
    } finally {
      setExchanging(false);
    }
  }, [onSuccess]);

  const onExitCallback = useCallback((err: any, metadata: any) => {
    if (err) {
      console.log('Plaid Link exit error:', err);
      if (err.error_code === 'USER_EXITED') {
        // User cancelled - this is normal, don't show error
        return;
      }
      setError('Bank connection was cancelled or failed');
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
    const baseClasses = "font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline disabled:opacity-50 transition-colors duration-200";
    
    if (className) return `${baseClasses} ${className}`;
    
    if (variant === 'primary') {
      return `${baseClasses} bg-green-500 hover:bg-green-700 text-white`;
    } else {
      return `${baseClasses} bg-gray-500 hover:bg-gray-700 text-white`;
    }
  };

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
      <div className="text-center">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
        <button 
          onClick={() => window.location.reload()} 
          className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
        >
          Try Again
        </button>
      </div>
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
    <button
      onClick={handleClick}
      className={getButtonClasses()}
      disabled={!ready}
    >
      {buttonText}
    </button>
  );
};