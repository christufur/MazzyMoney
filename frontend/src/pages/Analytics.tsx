import React, { useState, useEffect } from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import { analyticsAPI } from '../services/api';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

interface TrendData {
  month: string;
  [key: string]: any;
}

interface Insight {
  category: string;
  change: number;
  percentChange: number;
  type: 'increase' | 'decrease';
  severity: 'high' | 'medium';
}

interface Merchant {
  name: string;
  totalSpent: number;
  transactionCount: number;
  categories: string[];
  averageSpent: number;
  lastTransaction: string;
}

interface DayPattern {
  day: string;
  totalSpent: number;
  transactionCount: number;
  averageSpent: number;
}

const AnalyticsPage: React.FC = () => {
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [dayPatterns, setDayPatterns] = useState<DayPattern[]>([]);
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'trends' | 'insights' | 'merchants' | 'patterns' | 'forecast'>('trends');

  useEffect(() => {
    fetchAnalyticsData();
  }, []);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      const [trendsRes, insightsRes, merchantsRes, patternsRes, forecastRes] = await Promise.all([
        analyticsAPI.getTrends(12),
        analyticsAPI.getInsights(),
        analyticsAPI.getMerchants(10),
        analyticsAPI.getDayOfWeekPatterns(),
        analyticsAPI.getForecast()
      ]);

      setTrends(trendsRes.trends);
      setInsights(insightsRes.insights);
      setMerchants(merchantsRes.merchants);
      setDayPatterns(patternsRes.patterns);
      setForecast(forecastRes);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch analytics data');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Food & Dining': '#ff6b6b',
      'Transportation': '#4ecdc4',
      'Shopping': '#45b7d1',
      'Entertainment': '#f9ca24',
      'Bills & Utilities': '#f0932b',
      'Healthcare': '#eb4d4b',
      'Travel': '#6c5ce7',
      'Financial': '#a4b0be',
      'Housing': '#fd79a8',
      'Income': '#00b894',
      'Other': '#636e72'
    };
    return colors[category] || '#636e72';
  };

  if (loading) {
    return (
      <SidebarLayout title="Analytics">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3">Loading analytics...</span>
        </div>
      </SidebarLayout>
    );
  }

  if (error) {
    return (
      <SidebarLayout title="Analytics">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout title="Advanced Analytics">
      <div className="space-y-6">
        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6">
              {[
                { id: 'trends', name: 'Spending Trends' },
                { id: 'insights', name: 'Insights' },
                { id: 'merchants', name: 'Top Merchants' },
                { id: 'patterns', name: 'Day Patterns' },
                { id: 'forecast', name: 'Forecast' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Trends Tab */}
        {activeTab === 'trends' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Spending Trends (12 Months)</h3>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Legend />
                  {Object.keys(trends[0] || {}).filter(key => key !== 'month').map((category, index) => (
                    <Line
                      key={category}
                      type="monotone"
                      dataKey={category}
                      stroke={getCategoryColor(category)}
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Insights Tab */}
        {activeTab === 'insights' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Spending Insights</h3>
              {insights.length > 0 ? (
                <div className="space-y-4">
                  {insights.map((insight, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900">{insight.category}</h4>
                          <p className="text-sm text-gray-500">
                            {insight.type === 'increase' ? 'Increased' : 'Decreased'} by {Math.abs(insight.percentChange).toFixed(1)}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${
                            insight.type === 'increase' ? 'text-red-600' : 'text-green-600'
                          }`}>
                            {insight.type === 'increase' ? '+' : ''}{formatCurrency(insight.change)}
                          </p>
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            insight.severity === 'high' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {insight.severity === 'high' ? 'High Impact' : 'Medium Impact'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No significant spending changes detected.</p>
              )}
            </div>
          </div>
        )}

        {/* Merchants Tab */}
        {activeTab === 'merchants' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Top Merchants</h3>
              <div className="space-y-4">
                {merchants.map((merchant, index) => (
                  <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="font-medium text-gray-900">{merchant.name}</h4>
                      <p className="text-sm text-gray-500">
                        {merchant.transactionCount} transactions • Avg: {formatCurrency(merchant.averageSpent)}
                      </p>
                      <div className="flex space-x-2 mt-1">
                        {merchant.categories.map((category, catIndex) => (
                          <span
                            key={catIndex}
                            className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800"
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-gray-900">
                        {formatCurrency(merchant.totalSpent)}
                      </p>
                      <p className="text-sm text-gray-500">
                        Last: {new Date(merchant.lastTransaction).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Day Patterns Tab */}
        {activeTab === 'patterns' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Spending by Day of Week</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dayPatterns}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="totalSpent" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Forecast Tab */}
        {activeTab === 'forecast' && forecast && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Spending Forecast (Next Month)</h3>
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  Data Quality: {Math.round(forecast.dataQuality * 100)}% • 
                  Total Predicted: {formatCurrency(forecast.totalPredicted)}
                </p>
              </div>
              <div className="space-y-3">
                {forecast.forecast.map((item: any, index: number) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <h4 className="font-medium text-gray-900">{item.category}</h4>
                      <p className="text-sm text-gray-500">
                        Confidence: {Math.round(item.confidence * 100)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-gray-900">
                        {formatCurrency(item.predictedAmount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
};

export default AnalyticsPage;
