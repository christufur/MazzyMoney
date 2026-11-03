import React, { useCallback, useEffect, useState } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { PlaidLink } from '../components/plaid/PlaidLink';
import ManualAccounts from '../components/accounts/ManualAccounts';
import { plaidAPI } from '../services/api';
import type { PlaidItem, PlaidItemStatus, PlaidItemsResponse } from '../services/api';

const POLL_INTERVAL_MS = 5000;

const statusStyles: Record<PlaidItemStatus, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    SYNCING: 'bg-blue-100 text-blue-800',
    LOGIN_REQUIRED: 'bg-amber-100 text-amber-800',
    ERROR: 'bg-red-100 text-red-800',
};

const statusLabels: Record<PlaidItemStatus, string> = {
    ACTIVE: 'Active',
    SYNCING: 'Syncing',
    LOGIN_REQUIRED: 'Login needed',
    ERROR: 'Error',
};

const formatLastSync = (lastSyncAt: string | null) => {
    if (!lastSyncAt) return 'Never';
    const date = new Date(lastSyncAt);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

const formatMask = (mask: string | null) => (mask ? `••${mask}` : '');

const formatSubtype = (subtype: string) =>
    subtype && subtype !== 'unknown' ? subtype.replace(/_/g, ' ') : 'account';

const ConnectionsPage: React.FC = () => {
    const [data, setData] = useState<PlaidItemsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [removingId, setRemovingId] = useState<string | null>(null);

    const fetchItems = useCallback(async (options: { silent?: boolean } = {}) => {
        try {
            if (!options.silent) {
                setLoading(true);
            }
            setError(null);
            const response = await plaidAPI.getItems();
            setData(response);
        } catch (err: any) {
            console.error('Error fetching connected banks:', err);
            setError(err.response?.data?.error || 'Failed to load connections.');
        } finally {
            if (!options.silent) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    // Poll while a bank is syncing, and stop as soon as none is.
    const hasSyncingItem = Boolean(data?.items.some((item) => item.status === 'SYNCING'));

    useEffect(() => {
        if (!hasSyncingItem) {
            return;
        }

        const timer = setInterval(() => {
            fetchItems({ silent: true });
        }, POLL_INTERVAL_MS);

        return () => clearInterval(timer);
    }, [hasSyncingItem, fetchItems]);

    const handleRemove = async (item: PlaidItem) => {
        const confirmed = window.confirm(
            `Remove ${item.institutionName}? Its accounts and transactions will be deleted from Mazzy Money.`
        );

        if (!confirmed) {
            return;
        }

        try {
            setRemovingId(item.id);
            setError(null);
            await plaidAPI.removeItem(item.id);
            await fetchItems();
        } catch (err: any) {
            console.error('Remove bank error:', err);
            setError(err.response?.data?.error || `Failed to remove ${item.institutionName}.`);
        } finally {
            setRemovingId(null);
        }
    };

    const items = data?.items ?? [];
    const used = data?.used ?? 0;
    const limit = data?.limit ?? 10;
    const atLimit = used >= limit;
    const progressPercent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

    const addBankButton = <PlaidLink onSuccess={() => fetchItems()} buttonText="Add bank" disabled={atLimit} />;

    if (loading) {
        return (
            <SidebarLayout title="Connections">
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3">Loading connections...</span>
                </div>
            </SidebarLayout>
        );
    }

    return (
        <SidebarLayout title="Connections">
            <div className="space-y-6">
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-sm">
                        <div className="flex justify-between items-center">
                            <span>{error}</span>
                            <button
                                onClick={() => fetchItems()}
                                className="ml-4 text-red-600 hover:text-red-800 underline"
                            >
                                Try Again
                            </button>
                        </div>
                    </div>
                )}

                {/* Bank limit */}
                <div className="bg-white rounded-lg shadow-sm p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-gray-500">Banks used</p>
                            <p className="text-2xl font-bold text-gray-900">
                                Banks used: {used} / {limit}
                            </p>
                            <div className="mt-2 h-2 w-full max-w-xs bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full ${atLimit ? 'bg-red-500' : 'bg-blue-600'}`}
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            {atLimit && (
                                <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
                                    All {limit} free bank connections are in use. Remove one to connect another bank.
                                </p>
                            )}
                        </div>
                        {/* The empty state below carries the button when there is nothing to add to. */}
                        {items.length > 0 && <div>{addBankButton}</div>}
                    </div>
                </div>

                {items.length === 0 ? (
                    <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">No banks connected yet</h3>
                        <p className="text-gray-600 mb-6 max-w-md mx-auto">
                            Connect a bank to see its accounts, balances, and transactions in Mazzy Money.
                        </p>
                        {addBankButton}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {items.map((item) => (
                            <div key={item.id} className="bg-white rounded-lg shadow-sm p-6">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                    <div>
                                        <div className="flex items-center space-x-3">
                                            <h3 className="text-xl font-semibold text-gray-900">{item.institutionName}</h3>
                                            <span
                                                className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                                    statusStyles[item.status] ?? 'bg-gray-100 text-gray-800'
                                                }`}
                                            >
                                                {statusLabels[item.status] ?? item.status}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1">Last sync: {formatLastSync(item.lastSyncAt)}</p>
                                        {item.status === 'ERROR' && item.lastError && (
                                            <p className="text-xs text-red-600 mt-1">{item.lastError}</p>
                                        )}
                                        <p className="text-xs text-gray-400 mt-1">
                                            {item.accounts.length} account{item.accounts.length !== 1 ? 's' : ''}
                                        </p>
                                    </div>

                                    <div className="flex items-start space-x-3">
                                        {/* Update mode: reconnect the existing Item instead of using another free place. */}
                                        {item.status === 'LOGIN_REQUIRED' && (
                                            <PlaidLink
                                                itemId={item.id}
                                                buttonText="Reconnect"
                                                onSuccess={() => fetchItems()}
                                            />
                                        )}
                                        <button
                                            onClick={() => handleRemove(item)}
                                            disabled={removingId === item.id}
                                            className="bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                                        >
                                            {removingId === item.id ? 'Removing...' : 'Remove'}
                                        </button>
                                    </div>
                                </div>

                                {item.accounts.length > 0 && (
                                    <ul className="mt-4 pt-4 border-t border-gray-200 divide-y divide-gray-100">
                                        {item.accounts.map((account) => (
                                            <li key={account.id} className="py-2 flex items-center justify-between">
                                                <div className="flex items-center space-x-2 min-w-0">
                                                    <span className="text-sm font-medium text-gray-900 truncate">
                                                        {account.name}
                                                    </span>
                                                    {account.mask && (
                                                        <span className="text-sm text-gray-500">{formatMask(account.mask)}</span>
                                                    )}
                                                </div>
                                                <span className="text-xs text-gray-500 capitalize">
                                                    {formatSubtype(account.subtype)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Accounts Plaid does not connect: the 401(k), car, house, cash. */}
                <ManualAccounts />
            </div>
        </SidebarLayout>
    );
};

export default ConnectionsPage;
