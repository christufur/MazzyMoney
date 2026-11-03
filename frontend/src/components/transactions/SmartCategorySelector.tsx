import React, { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { transactionAPI, categoryAPI } from '../../services/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface SmartCategorySelectorProps {
  transactionId: string;
  currentCategory: string;
  onUpdate: (category: string) => void;
  compact?: boolean;
  /** A page that already has the list passes it in; otherwise the selector loads it. */
  categories?: string[];
  className?: string;
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

/**
 * The category on a ledger row, as a quiet pill. One list for every row, one muted
 * treatment for every category: the ledger never paints categories in a rainbow.
 */
export const SmartCategorySelector: React.FC<SmartCategorySelectorProps> = ({
  transactionId,
  currentCategory,
  onUpdate,
  compact = false,
  categories: presetCategories,
  className,
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
    if (category === currentCategory) {
      setIsOpen(false);
      return;
    }

    try {
      setUpdating(true);
      setError(null);
      await transactionAPI.updateCategory(transactionId, category);
      onUpdate(category);
      setIsOpen(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not change the category. Try again.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        disabled={updating}
        aria-label={`Category: ${currentCategory}`}
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-full bg-muted text-ink transition-colors hover:bg-secondary disabled:opacity-50',
          compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
          className
        )}
      >
        <span className="truncate">{updating ? 'Saving…' : currentCategory}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-56 p-1">
        {error && <p className="px-2 py-1.5 text-xs text-terra">{error}</p>}

        {loading ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading categories…</p>
        ) : categories.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No categories available</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {categories.map(category => {
              const isCurrent = category === currentCategory;

              return (
                <button
                  type="button"
                  key={category}
                  aria-pressed={isCurrent}
                  onClick={() => handleCategoryChange(category)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink hover:bg-paper',
                    isCurrent && 'font-medium'
                  )}
                >
                  <span className="truncate">{category}</span>
                  {isCurrent && <Check className="size-4 shrink-0 text-sage-ink" strokeWidth={1.75} />}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
