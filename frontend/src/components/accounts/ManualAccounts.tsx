import React, { useCallback, useEffect, useState } from 'react';
import { accountAPI } from '../../services/api';
import type { AccountListItem, ManualAccountKind } from '../../services/api';

/**
 * Manual accounts are for the things Plaid does not connect well or cheaply:
 * the 401(k), cars, the house, and cash. Each one uses no Plaid Item.
 */
const KIND_OPTIONS: Array<{ value: ManualAccountKind; label: string }> = [
  { value: 'retirement', label: 'Retirement (401k, IRA)' },
  { value: 'investment', label: 'Investment' },
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'cash', label: 'Cash' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

const kindLabel = (kind: string) => {
  const option = KIND_OPTIONS.find((candidate) => candidate.value === kind);
  return option ? option.label : kind.replace(/_/g, ' ');
};

const formatMoney = (amount: number) =>
  amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatSignedBalance = (account: AccountListItem) => {
  const amount = account.isLiability
    ? -Math.abs(account.balances.current)
    : account.balances.current;
  return formatMoney(amount);
};

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const errorMessage = (err: any) => {
  const serverError = err?.response?.data?.error;
  if (typeof serverError === 'string' && serverError.trim()) {
    return serverError;
  }
  return 'Something went wrong. Try again.';
};

interface BalanceRowProps {
  account: AccountListItem;
  onSaved: () => Promise<void>;
}

/** Inline "Update balance" editor: amount plus an optional past date. */
const BalanceRow: React.FC<BalanceRowProps> = ({ account, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(todayIsoDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setBalance(String(account.balances.current));
    setDate(todayIsoDate());
    setError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    const parsed = Number(balance);
    if (balance.trim() === '' || !Number.isFinite(parsed)) {
      setError('Enter a number for the balance.');
      return;
    }
    if (date > todayIsoDate()) {
      setError('The date cannot be in the future.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await accountAPI.updateManualBalance(
        account.id,
        parsed,
        date === todayIsoDate() ? undefined : date
      );
      setEditing(false);
      await onSaved();
    } catch (err: any) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={open}
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          Update balance
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center space-x-2">
        <label className="sr-only" htmlFor={`balance-${account.id}`}>
          New balance for {account.name}
        </label>
        <input
          id={`balance-${account.id}`}
          type="number"
          step="0.01"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          className="w-32 px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <label className="sr-only" htmlFor={`balance-date-${account.id}`}>
          Balance date for {account.name}
        </label>
        <input
          id={`balance-date-${account.id}`}
          type="date"
          value={date}
          max={todayIsoDate()}
          onChange={(event) => setDate(event.target.value)}
          className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <div className="flex items-center space-x-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-3 py-1 rounded-md text-sm font-medium transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
};

const ManualAccounts: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add form
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ManualAccountKind>('retirement');
  const [balance, setBalance] = useState('');
  const [isLiability, setIsLiability] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchManualAccounts = useCallback(async () => {
    try {
      setLoadError(null);
      const response = await accountAPI.getAccounts();
      const all: AccountListItem[] = response?.accounts ?? [];
      setAccounts(all.filter((account) => account.isManual));
    } catch (err: any) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchManualAccounts();
  }, [fetchManualAccounts]);

  const handleKindChange = (value: ManualAccountKind) => {
    setKind(value);
    // A loan is a liability: check the box for it and uncheck it when leaving.
    setIsLiability(value === 'loan');
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 80) {
      setFormError('Enter a name of 1 to 80 characters.');
      return;
    }
    const parsedBalance = Number(balance);
    if (balance.trim() === '' || !Number.isFinite(parsedBalance)) {
      setFormError('Enter a number for the balance.');
      return;
    }

    try {
      setCreating(true);
      setFormError(null);
      await accountAPI.createManual({
        name: trimmedName,
        kind,
        balance: parsedBalance,
        isLiability,
      });
      setName('');
      setKind('retirement');
      setBalance('');
      setIsLiability(false);
      await fetchManualAccounts();
    } catch (err: any) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (account: AccountListItem) => {
    const confirmed = window.confirm(
      `Delete ${account.name}? Its balance history will be deleted too.`
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(account.id);
      setActionError(null);
      await accountAPI.deleteManual(account.id);
      await fetchManualAccounts();
    } catch (err: any) {
      setActionError(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-gray-900">Manual accounts</h3>
        <p className="text-sm text-gray-500 mt-1">
          For accounts Plaid does not connect: 401(k), car, house, cash.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center text-gray-500 py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-sm">Loading manual accounts...</span>
        </div>
      ) : (
        <>
          {loadError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <div className="flex justify-between items-center">
                <span>{loadError}</span>
                <button
                  onClick={() => fetchManualAccounts()}
                  className="ml-4 text-red-600 hover:text-red-800 underline"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-sm">
              {actionError}
            </div>
          )}

          {accounts.length === 0 ? (
            <p className="text-gray-600 text-sm py-2">
              No manual accounts yet. Add the 401(k), car, house, or cash below.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 border-t border-gray-200">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{account.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{kindLabel(account.type)}</p>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span
                      className={`text-sm font-semibold ${
                        account.isLiability ? 'text-red-600' : 'text-gray-900'
                      }`}
                    >
                      {formatSignedBalance(account)}
                    </span>
                    <BalanceRow account={account} onSaved={fetchManualAccounts} />
                    <button
                      onClick={() => handleDelete(account)}
                      disabled={deletingId === account.id}
                      className="bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white px-3 py-1 rounded-md text-sm font-medium transition-colors"
                    >
                      {deletingId === account.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleCreate} className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Add account</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label htmlFor="manual-name" className="block text-xs font-medium text-gray-500 mb-1">
                  Name
                </label>
                <input
                  id="manual-name"
                  type="text"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Fidelity 401(k)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="manual-kind" className="block text-xs font-medium text-gray-500 mb-1">
                  Kind
                </label>
                <select
                  id="manual-kind"
                  value={kind}
                  onChange={(event) => handleKindChange(event.target.value as ManualAccountKind)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="manual-balance" className="block text-xs font-medium text-gray-500 mb-1">
                  Balance
                </label>
                <input
                  id="manual-balance"
                  type="number"
                  step="0.01"
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center space-x-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={isLiability}
                    onChange={(event) => setIsLiability(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>This is a liability</span>
                </label>
              </div>
            </div>

            {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}

            <div className="mt-4">
              <button
                type="submit"
                disabled={creating}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {creating ? 'Adding...' : 'Add account'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
};

export default ManualAccounts;
