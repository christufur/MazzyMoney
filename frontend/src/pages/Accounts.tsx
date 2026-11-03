import React, { useState, useEffect } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { PlaidLink } from '../components/plaid/PlaidLink';
import { plaidAPI, accountAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

interface Account {
    account_id: string;
    name: string;
    balances: {
        current: number;
        available: number | null;
    };
    type: string;
    subtype: string;
    mask: string;
}

interface Institution {
    name: string;
    item_id: string;
    connected_at: string | null;
}

interface AccountsData {
    accounts: Account[];
    institution: Institution | null;
    connected: boolean;
    syncStatus?: string;
    summary?: {
        totalAccounts: number;
        totalBalance: number;
        totalAvailable: number;
    };
}

const AccountsPage: React.FC = () => {
    const { user, updateUser } = useAuth();
    const [accountsData, setAccountsData] = useState<AccountsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [syncing, setSyncing] = useState(false);


    const handleManualAccountSync = async () => {
        try {
            setSyncing(true);
            console.log('Starting manual account sync...');

            const response = await api.post('/api/accounts/sync');
            console.log('Manual sync result:', response.data);

            // Refresh accounts after sync
            await fetchAccounts();

            alert(`Sync completed! ${response.data.message}`);
        } catch (err: any) {
            console.error('Manual sync failed:', err);
            const errorMessage = err.response?.data?.error || 'Failed to sync accounts';
            alert(`Sync failed: ${errorMessage}`);
        } finally {
            setSyncing(false);
        }
    };

    const fetchAccounts = async () => {
        try {
            setLoading(true);
            setError(null);

            console.log('Fetching accounts...');

            // Try the new cached endpoint first, fall back to Plaid endpoint
            let response;
            try {
                response = await accountAPI.getAccounts();
                console.log('Using cached accounts data');
            } catch (cachedException) {
                console.log('Cached accounts failed, trying Plaid endpoint');
                response = await plaidAPI.getAccounts?.();
            }

            console.log('Accounts response:', response);
            setAccountsData(response);
        } catch (err: any) {
            console.error('Error fetching accounts:', err);
            const errorMessage = err.response?.data?.error || 'Failed to fetch accounts';
            setError(errorMessage);

            // If it's a token expiration, update user state
            if (err.response?.data?.reconnect_required) {
                updateUser({
                    plaidItemId: null,
                    plaidAccessToken: null
                });
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    const handlePlaidSuccess = async () => {
        console.log('Plaid connection successful, refreshing accounts...');

        // Update user state to show connected
        updateUser({
            plaidItemId: 'connected', // Will be updated with real data from backend
            plaidAccessToken: 'connected'
        });

        // Wait a moment for the backend sync to start
        setTimeout(() => {
            fetchAccounts();
        }, 2000);
    };

    const handleDisconnect = async () => {
        const confirmMessage = 'Are you sure you want to disconnect your bank account? This will remove all connected accounts and you will need to reconnect to view your financial data.';

        if (!window.confirm(confirmMessage)) {
            return;
        }

        try {
            setDisconnecting(true);
            console.log('Disconnecting bank account...');

            await plaidAPI.disconnectBank();

            // Update user state
            updateUser({
                plaidItemId: null,
                plaidAccessToken: null
            });

            // Refresh accounts data
            await fetchAccounts();

            alert('Bank account disconnected successfully!');

        } catch (err: any) {
            console.error('Disconnect error:', err);
            const errorMessage = err.response?.data?.error || 'Failed to disconnect bank account';
            alert(errorMessage);
        } finally {
            setDisconnecting(false);
        }
    };

    const handleRefresh = async () => {
        try {
            setRefreshing(true);
            console.log('Refreshing connection...');

            await plaidAPI.refreshConnection();
            await fetchAccounts();

            alert('Connection refreshed successfully!');
        } catch (err: any) {
            console.error('Refresh error:', err);

            if (err.response?.data?.reconnect_required) {
                alert('Your connection has expired. Please reconnect your bank account.');
                updateUser({
                    plaidItemId: null,
                    plaidAccessToken: null
                });
                await fetchAccounts();
            } else {
                const errorMessage = err.response?.data?.error || 'Failed to refresh connection';
                alert(errorMessage);
            }
        } finally {
            setRefreshing(false);
        }
    };

    const refreshUserData = async () => {
        try {
            console.log('Refreshing user data...');
            const response = await api.get('/api/auth/me');
            console.log('Fresh user data from server:', response.data.user);

            // Update user context with fresh data
            updateUser(response.data.user);

            alert(`User data refreshed! Plaid Item ID: ${response.data.user.plaidItemId}`);
        } catch (error: any) {
            console.error('Failed to refresh user data:', error);
            alert('Failed to refresh user data');
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    };

    const getAccountTypeColor = (type: string) => {
        switch (type.toLowerCase()) {
            case 'checking': return 'bg-blue-100 text-blue-800';
            case 'savings': return 'bg-green-100 text-green-800';
            case 'credit': return 'bg-purple-100 text-purple-800';
            case 'investment': return 'bg-orange-100 text-orange-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (loading) {
        return (
            <SidebarLayout title="Accounts">
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3">Loading accounts...</span>
                </div>
            </SidebarLayout>
        );
    }

    return (
        <SidebarLayout title="Bank Accounts">
            <div className="space-y-6">
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                        <div className="flex justify-between items-center">
                            <span>{error}</span>
                            <button
                                onClick={fetchAccounts}
                                className="ml-4 text-red-600 hover:text-red-800 underline"
                            >
                                Try Again
                            </button>
                        </div>
                    </div>
                )}

                {!accountsData?.connected ? (
                    // No bank connected state
                    <div className="bg-white rounded-lg shadow p-8">
                        <div className="text-center">
                            <div className="mx-auto h-16 w-16 text-gray-400 mb-4">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 48 48">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                                        d="M12 8v8.01M12 8c0 1.105.895 2 2 2s2-.895 2-2-2-2-2-2c-1.105 0-2 .895-2 2zM16 8c0-1.105.895-2 2-2s2 .895 2 2-.895 2-2 2-2-.895-2-2z" />
                                </svg>
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 mb-2">
                                Connect Your Bank Account
                            </h3>
                            <p className="text-gray-600 mb-6 max-w-md mx-auto">
                                Securely connect your bank account to view balances, track transactions,
                                and manage your finances all in one place.
                            </p>
                            <PlaidLink onSuccess={handlePlaidSuccess} />

                            <div className="mt-8 text-sm text-gray-500">
                                <h4 className="font-semibold mb-2">Why connect your bank?</h4>
                                <ul className="space-y-1">
                                    <li>• View real-time account balances</li>
                                    <li>• Track spending by category</li>
                                    <li>• Monitor financial health</li>
                                    <li>• Generate detailed reports</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                ) : (
                    // Connected bank state
                    <div className="space-y-6">
                        {/* Institution Header */}
                        <button
                            onClick={refreshUserData}
                            className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                        >
                            Refresh User Data
                        </button>
                        <div className="bg-white rounded-lg shadow p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-semibold text-gray-900">
                                        {accountsData.institution?.name || 'Connected Bank'}
                                    </h3>
                                    <p className="text-sm text-gray-500">
                                        Connected • {accountsData.accounts.length} account{accountsData.accounts.length !== 1 ? 's' : ''}
                                    </p>
                                    {accountsData.institution?.connected_at && (
                                        <p className="text-xs text-gray-400">
                                            Connected on {new Date(accountsData.institution.connected_at).toLocaleDateString()}
                                        </p>
                                    )}
                                    {accountsData.syncStatus && (
                                        <p className="text-xs text-blue-600">
                                            Sync Status: {accountsData.syncStatus}
                                        </p>
                                    )}

                                    {/* Show warning if no accounts but connected */}
                                    {accountsData.connected && accountsData.accounts.length === 0 && (
                                        <div className="mt-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-sm">
                                            <span className="text-yellow-800">
                                                ⚠️ Connected but no accounts found. Try syncing accounts manually.
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex space-x-3">
                                    {/* Manual Account Sync Button */}
                                    {accountsData.connected && accountsData.accounts.length === 0 && (
                                        <button
                                            onClick={handleManualAccountSync}
                                            disabled={syncing}
                                            className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                                        >
                                            {syncing ? (
                                                <span className="flex items-center">
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                    Syncing Accounts...
                                                </span>
                                            ) : (
                                                'Sync Accounts'
                                            )}
                                        </button>
                                    )}

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
                        </div>

                        {/* Accounts Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {accountsData.accounts.map((account) => (
                                <div key={account.account_id} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <h4 className="text-lg font-semibold text-gray-900 mb-1">
                                                {account.name}
                                            </h4>
                                            <p className="text-sm text-gray-500">
                                                {account.mask ? `****${account.mask}` : 'No mask available'}
                                            </p>
                                        </div>
                                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getAccountTypeColor(account.subtype)}`}>
                                            {account.subtype}
                                        </span>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-600">Current Balance</span>
                                            <span className="text-xl font-bold text-gray-900">
                                                {formatCurrency(account.balances.current)}
                                            </span>
                                        </div>

                                        {account.balances.available !== null && account.balances.available !== account.balances.current && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm text-gray-600">Available</span>
                                                <span className="text-sm font-medium text-gray-700">
                                                    {formatCurrency(account.balances.available)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-gray-200">
                                        <div className="flex justify-between text-xs text-gray-500">
                                            <span>Account Type</span>
                                            <span className="capitalize">{account.type}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Account Summary */}
                        <div className="bg-white rounded-lg shadow p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Account Summary</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-blue-600">
                                        {accountsData.accounts.length}
                                    </p>
                                    <p className="text-sm text-gray-600">Total Accounts</p>
                                </div>

                                <div className="text-center">
                                    <p className="text-2xl font-bold text-green-600">
                                        {formatCurrency(
                                            accountsData.summary?.totalBalance ||
                                            accountsData.accounts.reduce((sum, account) => sum + account.balances.current, 0)
                                        )}
                                    </p>
                                    <p className="text-sm text-gray-600">Total Balance</p>
                                </div>

                                <div className="text-center">
                                    <p className="text-2xl font-bold text-purple-600">
                                        {formatCurrency(
                                            accountsData.summary?.totalAvailable ||
                                            accountsData.accounts
                                                .filter(account => account.balances.available !== null)
                                                .reduce((sum, account) => sum + (account.balances.available || 0), 0)
                                        )}
                                    </p>
                                    <p className="text-sm text-gray-600">Available Funds</p>
                                </div>
                            </div>
                        </div>

                        
                    </div>
                )}
            </div>
        </SidebarLayout>
    );
};

export default AccountsPage;