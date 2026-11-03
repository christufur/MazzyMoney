import React, { useState, useEffect } from 'react';
import { transactionAPI, categoryAPI } from '../../services/api';

interface SmartCategorySelectorProps {
  transactionId: string;
  currentCategory: string;
  onUpdate: (category: string) => void;
  compact?: boolean;
  /** A page that already has the list passes it in; otherwise the selector loads it. */
  categories?: string[];
}

// One request for the whole app: the list is owned by the backend and never changes
// while the app is open, so every selector on the page shares this promise.
let categoriesPromise: Promise<string[]> | null = null;

const loadCategories = (): Promise<string[]> => {
  if (!categoriesPromise) {
    categoriesPromise = categoryAPI
      .getAll()
      .then(response => response.categories ?? [])
      .catch(error => {
        console.error('Failed to load categories:', error);
        // Allow a retry on the next selector that opens.
        categoriesPromise = null;
        return [];
      });
  }
  return categoriesPromise;
};

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    'Food & Dining': 'bg-orange-100 text-orange-800',
    'Groceries': 'bg-lime-100 text-lime-800',
    'Transportation': 'bg-blue-100 text-blue-800',
    'Shopping': 'bg-purple-100 text-purple-800',
    'Entertainment': 'bg-pink-100 text-pink-800',
    'Bills & Utilities': 'bg-yellow-100 text-yellow-800',
    'Healthcare': 'bg-red-100 text-red-800',
    'Travel': 'bg-green-100 text-green-800',
    'Loan Payments': 'bg-slate-100 text-slate-800',
    'Fees & Charges': 'bg-gray-100 text-gray-800',
    'Housing': 'bg-indigo-100 text-indigo-800',
    'Income': 'bg-emerald-100 text-emerald-800',
    'Transfer': 'bg-cyan-100 text-cyan-800',
    'Other': 'bg-gray-100 text-gray-600',
  };
  return colors[category] || colors['Other'];
};

export const SmartCategorySelector: React.FC<SmartCategorySelectorProps> = ({
  transactionId,
  currentCategory,
  onUpdate,
  compact = false,
  categories: presetCategories
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = presetCategories && presetCategories.length > 0 ? presetCategories : loaded;

  useEffect(() => {
    let active = true;

    // A page that owns the list hands it down, so no selector has to fetch.
    if (!isOpen || categories.length > 0) {
      return;
    }

    setLoading(true);
    loadCategories().then(list => {
      if (active) {
        setLoaded(list);
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
    // `categories.length` only makes this run again after a failed first load.
  }, [isOpen, categories.length]);

  const handleCategoryChange = async (category: string) => {
    try {
      setUpdating(true);
      setError(null);
      await transactionAPI.updateCategory(transactionId, category);
      onUpdate(category);
      setIsOpen(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update category');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        disabled={updating}
        className={`inline-flex items-center rounded-full font-medium ${getCategoryColor(
          currentCategory
        )} hover:opacity-80 disabled:opacity-50 ${
          compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
        }`}
      >
        {updating ? 'Saving...' : currentCategory}
        <svg className="ml-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-20">
          <div className="p-2">
            {error && <p className="text-xs text-red-600 px-2 py-1">{error}</p>}
            {loading ? (
              <div className="text-center py-2 text-sm text-gray-500">Loading categories...</div>
            ) : categories.length === 0 ? (
              <div className="text-center py-2 text-sm text-gray-500">No categories available</div>
            ) : (
              categories.map(category => (
                <button
                  type="button"
                  key={category}
                  onClick={() => handleCategoryChange(category)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 ${
                    category === currentCategory ? 'bg-blue-50 font-medium' : ''
                  }`}
                >
                  {category}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
