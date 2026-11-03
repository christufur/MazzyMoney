import React, { useState } from 'react';
import { PlaidLink } from './PlaidLink';
import { plaidAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

interface BankConnectionManagerProps {
  onConnectionChange?: () => void;
  showTitle?: boolean;
  compact?: boolean;
}

export const BankConnectionManager: React.FC<BankConnectionManagerProps> = ({
  onConnectionChange,
  showTitle = true,
  compact = false
}) => {
  const { user, updateUser } = useAuth();
  const [disconnecting, setDisconnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handlePlaidSuccess = () => {
    // Update user state to reflect connection
    updateUser({ 
      plaidItemId: 'connected', // Will be updated with real data from backend
      plaidAccessToken: 'connected' 
    });
    
    if (onConnectionChange) {
      onConnectionChange();
    }
  };

  const handleDisconnect = async () => {
    const confirmMessage = compact 
      ? 'Disconnect your bank account?' 
      : 'Are you sure you want to disconnect your bank account? This will remove all connected accounts and you will need to reconnect to view your financial data.';
      
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setDisconnecting(true);
      await plaidAPI.disconnectBank();
      
      // Update user state
      updateUser({ 
        plaidItemId: null, 
        plaidAccessToken: null 
      });
      
      if (onConnectionChange) {
        onConnectionChange();
      }
      
      if (!compact) {
        alert('Bank account disconnected successfully!');
      }
      
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to disconnect bank account');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await plaidAPI.refreshConnection();
      
      if (onConnectionChange) {
        onConnectionChange();
      }
      
      if (!compact) {
        alert('Connection refreshed successfully!');
      }
    } catch (err: any) {
      if (err.response?.data?.reconnect_required) {
        alert('Your connection has expired. Please reconnect your bank account.');
        // Update user state to show disconnected
        updateUser({ 
          plaidItemId: null, 
          plaidAccessToken: null 
        });
        if (onConnectionChange) {
          onConnectionChange();
        }
      } else {
        alert(err.response?.data?.error || 'Failed to refresh connection');
      }
    } finally {
      setRefreshing(false);
    }
  };

  if (compact) {
    // Compact version for sidebar or small spaces
    if (user?.plaidItemId) {
      return (
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2 text-green-600">
            <div className="h-2 w-2 bg-green-500 rounded-full"></div>
            <span className="text-sm">Bank Connected</span>
          </div>
          <div className="flex space-x-1">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-blue-300"
              title="Refresh Connection"
            >
              {refreshing ? '⟳' : '↻'}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="text-xs text-red-600 hover:text-red-800 disabled:text-red-300"
              title="Disconnect"
            >
              ×
            </button>
          </div>
        </div>
      );
    } else {
      return (
        <PlaidLink 
          onSuccess={handlePlaidSuccess}
          buttonText="Connect Bank"
          variant="secondary"
          className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded"
        />
      );
    }
  }

  // Full version for main content areas
  return (
    <div className="bg-white rounded-lg shadow p-6">
      {showTitle && (
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Bank Connection</h3>
        </div>
      )}

      {user?.plaidItemId ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2 text-green-600">
              <div className="h-3 w-3 bg-green-500 rounded-full"></div>
              <span>Bank Connected</span>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {refreshing ? (
                  <span className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Refreshing...
                  </span>
                ) : (
                  'Refresh'
                )}
              </button>
              
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {disconnecting ? (
                  <span className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Disconnecting...
                  </span>
                ) : (
                  'Disconnect'
                )}
              </button>
            </div>
          </div>
          
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-green-800">
                  Your bank account is connected and ready to use. You can now view transactions, track spending, and generate reports.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <svg fill="none" stroke="currentColor" viewBox="0 0 48 48">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} 
                d="M19 14l15 15-15 15m0 0H4m15 0V14" />
            </svg>
          </div>
          <h4 className="text-lg font-medium text-gray-900 mb-2">
            Connect your bank account
          </h4>
          <p className="text-gray-500 mb-4">
            Connect your bank account to view transactions and manage your finances
          </p>
          <PlaidLink onSuccess={handlePlaidSuccess} />
          
          <div className="mt-6 text-sm text-gray-500">
            <div className="flex items-center justify-center space-x-1 mb-2">
              <svg className="h-4 w-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">256-bit encryption</span>
            </div>
            <p>Your banking information is secure and encrypted.</p>
          </div>
        </div>
      )}
    </div>
  );
};