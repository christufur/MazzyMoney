import React, { useState, useEffect } from 'react';
import { transactionAPI } from '../../services/api';

interface SyncStatusProps {
  onSyncComplete?: () => void;
  compact?: boolean;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({ 
  onSyncComplete, 
  compact = false 
}) => {
  const [syncStatus, setSyncStatus] = useState<{
    connected: boolean;
    status: string;
    lastSyncAt: string | null;
    transactionCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchSyncStatus = async () => {
    try {
      const status = await transactionAPI.getSyncStatus();
      setSyncStatus(status);
      setSyncing(status.status === 'SYNCING');
    } catch (error) {
      console.error('Failed to fetch sync status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSyncStatus();
    
    // Poll sync status while syncing
    const interval = setInterval(() => {
      if (syncing) {
        fetchSyncStatus();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [syncing]);

  const handleSync = async (force: boolean = false) => {
    try {
      setSyncing(true);
      await transactionAPI.syncTransactions(force);
      
      // Poll for completion
      const pollInterval = setInterval(async () => {
        const status = await transactionAPI.getSyncStatus();
        setSyncStatus(status);
        
        if (status.status !== 'SYNCING') {
          setSyncing(false);
          clearInterval(pollInterval);
          if (onSyncComplete) {
            onSyncComplete();
          }
        }
      }, 2000);
    } catch (error: any) {
      console.error('Sync failed:', error);
      setSyncing(false);
      alert(error.response?.data?.error || 'Sync failed');
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center ${compact ? 'text-sm' : ''}`}>
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
        <span>Checking sync status...</span>
      </div>
    );
  }

  if (!syncStatus?.connected) {
    return compact ? null : (
      <div className="text-gray-500 text-sm">
        Connect your bank to enable sync
      </div>
    );
  }

  const getStatusDisplay = () => {
    switch (syncStatus.status) {
      case 'SYNCING':
        return {
          color: 'text-blue-600',
          icon: '🔄',
          text: 'Syncing...',
          bgColor: 'bg-blue-50 border-blue-200'
        };
      case 'SYNCED':
        return {
          color: 'text-green-600',
          icon: '✅',
          text: syncStatus.lastSyncAt 
            ? `Last synced: ${new Date(syncStatus.lastSyncAt).toLocaleString()}`
            : 'Synced',
          bgColor: 'bg-green-50 border-green-200'
        };
      case 'ERROR':
        return {
          color: 'text-red-600',
          icon: '❌',
          text: 'Sync failed',
          bgColor: 'bg-red-50 border-red-200'
        };
      case 'TOKEN_EXPIRED':
        return {
          color: 'text-yellow-600',
          icon: '⚠️',
          text: 'Connection expired - please reconnect',
          bgColor: 'bg-yellow-50 border-yellow-200'
        };
      case 'NEVER_SYNCED':
        return {
          color: 'text-gray-600',
          icon: '⏳',
          text: 'Never synced',
          bgColor: 'bg-gray-50 border-gray-200'
        };
      default:
        return {
          color: 'text-gray-600',
          icon: '❓',
          text: 'Unknown status',
          bgColor: 'bg-gray-50 border-gray-200'
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  if (compact) {
    return (
      <div className="flex items-center space-x-2 text-sm">
        <span className={statusDisplay.color}>
          {statusDisplay.icon}
        </span>
        <span className={statusDisplay.color}>
          {syncStatus.transactionCount} transactions
        </span>
        {syncStatus.status !== 'SYNCING' && (
          <button
            onClick={() => handleSync()}
            className="text-blue-600 hover:text-blue-800 text-xs underline"
            title="Sync now"
          >
            Sync
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`border rounded-lg p-4 ${statusDisplay.bgColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-2xl">{statusDisplay.icon}</span>
          <div>
            <div className={`font-medium ${statusDisplay.color}`}>
              {statusDisplay.text}
            </div>
            <div className="text-sm text-gray-600">
              {syncStatus.transactionCount} transactions stored locally
            </div>
          </div>
        </div>
        
        <div className="flex space-x-2">
          {syncStatus.status !== 'SYNCING' && syncStatus.status !== 'TOKEN_EXPIRED' && (
            <>
              <button
                onClick={() => handleSync()}
                disabled={syncing}
                className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-sm text-sm font-medium transition-colors"
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
              
              <button
                onClick={() => handleSync(true)}
                disabled={syncing}
                className="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-sm text-sm font-medium transition-colors"
                title="Force full resync"
              >
                Full Sync
              </button>
            </>
          )}
        </div>
      </div>

      {syncStatus.status === 'ERROR' && (
        <div className="mt-3 text-sm text-red-600">
          There was an issue syncing your transactions. Try syncing again or check your bank connection.
        </div>
      )}

      {syncStatus.status === 'TOKEN_EXPIRED' && (
        <div className="mt-3 text-sm text-yellow-600">
          Your bank connection has expired. Please reconnect your bank account to continue syncing.
        </div>
      )}

      {syncing && (
        <div className="mt-3">
          <div className="flex items-center text-sm text-blue-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
            Fetching latest transactions from your bank...
          </div>
          <div className="w-full bg-blue-200 rounded-full h-1 mt-2">
            <div className="bg-blue-600 h-1 rounded-full animate-pulse" style={{ width: '60%' }}></div>
          </div>
        </div>
      )}
    </div>
  );
};