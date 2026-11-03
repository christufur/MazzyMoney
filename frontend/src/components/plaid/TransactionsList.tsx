import React, { useState, useEffect } from 'react';
import { plaidAPI, transactionAPI } from '../../services/api';

interface Transaction {
  transaction_id: string;
  name: string;
  amount: number;
  date: string;
  category: string[] | null; 
  pending: boolean;
}

interface Account {
  account_id: string;
  name: string;
  balances: {
    current: number;
    available: number;
  };
  type: string;
  subtype: string;
}

interface TransactionsResponse {
  transactions: Transaction[];
  accounts: Account[];
  total_transactions: number;
}

export const TransactionsList: React.FC = () => {
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        setLoading(true);
        const response = await transactionAPI.getTransactions({
          page: 1,
          limit: 50
        });
        setData(response);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch transactions');
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Math.abs(amount));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading) {
    return <div className="text-center py-8">Loading transactions...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        {error}
      </div>
    );
  }

  if (!data || data.transactions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No transactions found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.accounts.map((account) => (
          <div key={account.account_id} className="bg-white shadow rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-2">{account.name}</h3>
            <p className="text-sm text-gray-600 mb-2">
              {account.type} • {account.subtype}
            </p>
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(account.balances.current)}
            </p>
            {account.balances.available && (
              <p className="text-sm text-gray-600 mt-1">
                Available: {formatCurrency(account.balances.available)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Transactions Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-xl font-semibold">
            Recent Transactions ({data.total_transactions})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.transactions.map((transaction) => (
                <tr key={transaction.transaction_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {transaction.name}
                        </div>
                        {transaction.pending && (
                          <div className="text-xs text-yellow-600">Pending</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                      {transaction.category && transaction.category.length > 0
                        ? transaction.category[0]
                        : 'Other'
                      }
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(transaction.date)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <span className={
                      transaction.amount > 0
                        ? 'text-red-600 font-semibold'
                        : 'text-green-600 font-semibold'
                    }>
                      {transaction.amount > 0 ? '-' : '+'}
                      {formatCurrency(transaction.amount)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};