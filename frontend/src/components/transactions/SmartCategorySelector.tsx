import React, { useState, useEffect } from 'react';
import { transactionAPI } from '../../services/api';

interface SmartCategorySelectorProps {
  transactionId: string;
  currentCategory: string;
  onUpdate: (category: string) => void;
  compact?: boolean;
}

interface Suggestion {
  category: string;
  confidence: number;
  reason: string;
}

export const SmartCategorySelector: React.FC<SmartCategorySelectorProps> = ({
  transactionId,
  currentCategory,
  onUpdate,
  compact = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const categories = [
    'Food & Dining',
    'Transportation',
    'Shopping',
    'Entertainment',
    'Bills & Utilities',
    'Healthcare',
    'Travel',
    'Financial',
    'Housing',
    'Income',
    'Other'
  ];

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Food & Dining': 'bg-orange-100 text-orange-800',
      'Transportation': 'bg-blue-100 text-blue-800',
      'Shopping': 'bg-purple-100 text-purple-800',
      'Entertainment': 'bg-pink-100 text-pink-800',
      'Bills & Utilities': 'bg-yellow-100 text-yellow-800',
      'Healthcare': 'bg-red-100 text-red-800',
      'Travel': 'bg-green-100 text-green-800',
      'Financial': 'bg-gray-100 text-gray-800',
      'Housing': 'bg-indigo-100 text-indigo-800',
      'Income': 'bg-emerald-100 text-emerald-800',
      'Other': 'bg-gray-100 text-gray-600'
    };
    return colors[category] || colors['Other'];
  };

  const loadSuggestions = async () => {
    try {
      setLoading(true);
      const response = await transactionAPI.getSuggestions(transactionId);
      setSuggestions(response.suggestions || []);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = async (category: string) => {
    try {
      setUpdating(true);
      await transactionAPI.updateCategory(transactionId, category);
      onUpdate(category);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to update category:', error);
    } finally {
      setUpdating(false);
    }
  };

  const handleToggle = () => {
    if (!isOpen && suggestions.length === 0) {
      loadSuggestions();
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        disabled={updating}
        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(currentCategory)} hover:opacity-80 disabled:opacity-50 ${
          compact ? 'px-1 py-0.5' : 'px-2 py-1'
        }`}
      >
        {updating ? 'Updating...' : currentCategory}
        <svg className="ml-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
          <div className="p-3">
            <div className="text-xs font-medium text-gray-500 mb-2">Smart Suggestions</div>
            
            {loading ? (
              <div className="text-center py-2 text-sm text-gray-500">Loading suggestions...</div>
            ) : suggestions.length > 0 ? (
              <div className="space-y-1 mb-3">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleCategoryChange(suggestion.category)}
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-100 flex justify-between items-center"
                  >
                    <span className={getCategoryColor(suggestion.category)}>
                      {suggestion.category}
                    </span>
                    <span className="text-gray-400">
                      {Math.round(suggestion.confidence * 100)}%
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-400 mb-3">No suggestions available</div>
            )}

            <div className="border-t pt-2">
              <div className="text-xs font-medium text-gray-500 mb-1">All Categories</div>
              <div className="grid grid-cols-2 gap-1">
                {categories.map(category => (
                  <button
                    key={category}
                    onClick={() => handleCategoryChange(category)}
                    className={`text-left px-2 py-1 rounded text-xs hover:bg-gray-100 ${
                      category === currentCategory ? 'bg-blue-100' : ''
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
