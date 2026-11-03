import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { SmartCategorySelector } from './SmartCategorySelector';
import { NoteTrigger, TransactionNotes } from './TransactionNotes';
import { accountLabel, amountTone, bankMemoOf, displayNameOf, shortDay, signedAmount } from './transaction';
import type { TransactionRow } from './transaction';

/** The ledger grid. One literal so the header and the rows can never drift apart. */
export const LEDGER_GRID = 'md:grid-cols-[auto_3.25rem_minmax(0,1fr)_9.5rem_9.5rem_6.5rem_auto]';

export interface TransactionRowViewProps {
  row: TransactionRow;
  /** The category list, loaded once by the page. */
  categories?: string[];
  selected?: boolean;
  /** Passing this shows the checkbox that puts the row in a bulk edit. */
  onSelect?: () => void;
  onCategoryChange?: (category: string) => void;
  onNoteChange?: (notes: string) => void;
  /** The trailing control: the reviewed toggle in the list, "Looks right" in review mode. */
  action?: React.ReactNode;
  /** Switches that open with the row's detail (transfer, hide). */
  detail?: React.ReactNode;
  /** The row under the keyboard cursor in review mode. */
  active?: boolean;
  /** Phone rows have no hover, so the note trigger and detail stay readable there. */
  alwaysShowDetail?: boolean;
}

/**
 * One transaction as a calm ledger row. The bank's own memo stays folded behind a
 * small toggle, so scanning fifty rows is fifty names and fifty amounts, not fifty
 * strings of terminal noise. "Add a note" lives on the name line and takes up no
 * height of its own; the saved note is one muted line underneath.
 */
export const TransactionRowView: React.FC<TransactionRowViewProps> = ({
  row,
  categories,
  selected = false,
  onSelect,
  onCategoryChange,
  onNoteChange,
  action,
  detail,
  active = false,
  alwaysShowDetail = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [editingNote, setEditingNote] = useState(false);

  const displayName = displayNameOf(row);
  const memo = bankMemoOf(row);
  const open = active || expanded || focused;
  // The category chip already says "Transfer"; a second pill in the same row would repeat it.
  const showTransferPill = row.isTransfer && row.primaryCategory !== 'Transfer';

  return (
    <div
      role="listitem"
      aria-current={active ? 'true' : undefined}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={cn(
        'group/row ledger-line grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3 transition-colors md:items-center md:gap-x-4 md:gap-y-0',
        LEDGER_GRID,
        selected || active ? 'bg-paper' : 'hover:bg-paper'
      )}
    >
      <span className="flex md:col-start-1 md:row-start-1">
        {onSelect ? (
          <Checkbox aria-label={`Select ${displayName}`} checked={selected} onCheckedChange={onSelect} />
        ) : (
          <span
            aria-hidden
            className={cn('mt-2 size-1.5 rounded-full md:mt-0', !row.reviewed && 'bg-terra')}
          />
        )}
      </span>

      <div className="min-w-0 md:col-start-3 md:row-start-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[15px] text-ink">{displayName}</span>

          <NoteTrigger
            label={row.notes ? 'Edit note' : 'Add a note'}
            onClick={() => setEditingNote(true)}
            alwaysVisible={alwaysShowDetail}
          />

          {memo && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`Bank memo for ${displayName}`}
              onClick={() => setExpanded(value => !value)}
              className="shrink-0 self-center rounded-sm text-muted-foreground/60 transition-colors hover:text-ink"
            >
              <ChevronDown
                className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
                strokeWidth={1.75}
              />
            </button>
          )}
        </div>

        {expanded && memo && <p className="mt-1 truncate text-xs text-muted-foreground">{memo}</p>}

        {(row.pending || showTransferPill) && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {row.pending && (
              <Badge variant="outline" className="text-muted-foreground">
                Pending
              </Badge>
            )}
            {showTransferPill && (
              <Badge variant="outline" className="text-muted-foreground">
                Transfer
              </Badge>
            )}
          </p>
        )}
      </div>

      <span
        className={cn(
          'self-start whitespace-nowrap text-right text-sm font-medium tabular-nums md:col-start-6 md:row-start-1 md:self-center',
          amountTone(row.amount)
        )}
      >
        {signedAmount(row.amount)}
      </span>

      <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-nowrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:contents">
        <span className="shrink-0 whitespace-nowrap md:col-start-2 md:row-start-1">
          {shortDay(row.date)}
        </span>

        {row.account && (
          <span className="flex min-w-0 items-center gap-1 md:col-start-4 md:row-start-1">
            <span aria-hidden className="md:hidden">
              ·
            </span>
            {/* The name gives way; the last four digits never do — they are how two cards differ. */}
            <span aria-hidden className="truncate">
              {row.account.name}
            </span>
            {row.account.mask && (
              <span aria-hidden className="shrink-0 whitespace-nowrap tabular-nums">
                ••{row.account.mask}
              </span>
            )}
            <span className="sr-only">{accountLabel(row.account)}</span>
          </span>
        )}

        <SmartCategorySelector
          transactionId={row.id}
          currentCategory={row.primaryCategory || 'Other'}
          categories={categories}
          compact
          className="shrink-0 md:col-start-5 md:row-start-1 md:justify-self-start"
          onUpdate={category => onCategoryChange?.(category)}
        />

        {action && (
          <span className="ml-auto shrink-0 md:col-start-7 md:row-start-1 md:ml-0 md:justify-self-end">
            {action}
          </span>
        )}
      </div>

      <div className="col-span-2 col-start-3 row-start-3 min-w-0 md:col-span-4 md:col-start-3 md:row-start-2">
        {detail && (open || alwaysShowDetail) && <div className="pb-1.5">{detail}</div>}
        <TransactionNotes
          transactionId={row.id}
          initialNotes={row.notes ?? ''}
          compact
          editing={editingNote}
          onEditingChange={setEditingNote}
          onUpdate={notes => onNoteChange?.(notes)}
        />
      </div>
    </div>
  );
};
