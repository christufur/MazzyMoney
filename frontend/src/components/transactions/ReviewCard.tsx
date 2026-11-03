import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SmartCategorySelector } from './SmartCategorySelector';
import { NoteTrigger, TransactionNotes } from './TransactionNotes';
import { RowToggle } from './RowToggle';
import { accountLabel, amountTone, bankMemoOf, displayNameOf, shortDay, signedAmount } from './transaction';
import type { TransactionRow } from './transaction';

export interface ReviewCardProps {
  row: TransactionRow;
  categories: string[];
  busy: boolean;
  memoOpen: boolean;
  onToggleMemo: () => void;
  editingNote: boolean;
  onEditingNote: (open: boolean) => void;
  onCategoryChange: (category: string) => void;
  onNoteChange: (notes: string) => void;
  onFlag: (changes: { isTransfer?: boolean; hidden?: boolean }) => void;
  onConfirm: () => void;
  onSkip: () => void;
  /** Position in the queue, for the one line "3 of 29" above the card. */
  refCallback?: (node: HTMLElement | null) => void;
}

/**
 * One card, the whole screen, on a phone. Everything the reader might want before
 * saying "Looks right" is on it: the name, the amount, the date, the account, the
 * category, the note, and the two switches. Nothing else competes for the thumb.
 */
export const ReviewCard: React.FC<ReviewCardProps> = ({
  row,
  categories,
  busy,
  memoOpen,
  onToggleMemo,
  editingNote,
  onEditingNote,
  onCategoryChange,
  onNoteChange,
  onFlag,
  onConfirm,
  onSkip,
  refCallback,
}) => {
  const displayName = displayNameOf(row);
  const memo = bankMemoOf(row);

  return (
    <article
      role="listitem"
      aria-label={displayName}
      ref={refCallback}
      className="flex w-full shrink-0 snap-center flex-col gap-4 p-5 md:hidden"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="min-w-0 text-xl font-semibold leading-snug text-ink">{displayName}</h3>
            {memo && (
              <button
                type="button"
                aria-expanded={memoOpen}
                aria-label={`Bank memo for ${displayName}`}
                onClick={onToggleMemo}
                className="shrink-0 self-center rounded-sm text-muted-foreground/60 transition-colors hover:text-ink"
              >
                <ChevronDown
                  className={cn('size-4 transition-transform', memoOpen && 'rotate-180')}
                  strokeWidth={1.75}
                />
              </button>
            )}
          </div>

          {memoOpen && memo && <p className="mt-1 text-xs text-muted-foreground">{memo}</p>}

          {row.pending && <p className="mt-1 text-xs text-muted-foreground">Pending at the bank</p>}
        </div>

        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-2xl font-semibold tabular-nums',
            amountTone(row.amount)
          )}
        >
          {signedAmount(row.amount)}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        {shortDay(row.date)}
        {row.account ? ` · ${accountLabel(row.account)}` : ''}
      </p>

      <SmartCategorySelector
        transactionId={row.id}
        currentCategory={row.primaryCategory || 'Other'}
        categories={categories}
        onUpdate={onCategoryChange}
      />

      <div className="flex flex-wrap items-center gap-2">
        <RowToggle
          label="Transfer"
          checked={row.isTransfer}
          onChange={checked => onFlag({ isTransfer: checked })}
        />
        <RowToggle
          label="Hide from totals"
          checked={row.hidden}
          onChange={checked => onFlag({ hidden: checked })}
        />
      </div>

      <div className="flex items-baseline gap-2">
        <NoteTrigger
          label={row.notes ? 'Edit note' : 'Add a note'}
          onClick={() => onEditingNote(true)}
          alwaysVisible
        />
      </div>

      <TransactionNotes
        transactionId={row.id}
        initialNotes={row.notes ?? ''}
        editing={editingNote}
        onEditingChange={onEditingNote}
        onUpdate={onNoteChange}
      />

      <div className="mt-auto flex items-center gap-2 pt-2">
        <Button className="flex-1" onClick={onConfirm} disabled={busy}>
          Looks right
        </Button>
        <Button variant="ghost" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
      </div>
    </article>
  );
};
