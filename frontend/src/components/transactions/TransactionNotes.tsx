import React, { useEffect, useState } from 'react';
import { transactionAPI } from '../../services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface TransactionNotesProps {
  transactionId: string;
  /** The saved note from the row. */
  initialNotes?: string;
  onUpdate: (notes: string) => void;
  /** Controlled from the row, so the trigger can sit on the name line. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  compact?: boolean;
  className?: string;
}

/**
 * The note on a ledger row: the saved line, or the small editor while it is open.
 * The trigger lives on the name line (see `NoteTrigger`), so a row without a note
 * is one line tall and reserves nothing for a control nobody asked for.
 */
export const TransactionNotes: React.FC<TransactionNotesProps> = ({
  transactionId,
  initialNotes = '',
  onUpdate,
  editing,
  onEditingChange,
  compact = false,
  className,
}) => {
  const [draft, setDraft] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening the editor always starts from what is saved, not from an abandoned draft.
  useEffect(() => {
    if (editing) {
      setDraft(initialNotes);
      setError(null);
    }
    // `initialNotes` is read when the editor opens; a save updates it through `onUpdate`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!editing) {
    if (!initialNotes) return null;
    // The "Edit note" control lives on the name line (see `NoteTrigger`); this is the note itself.
    return (
      <span className={cn('block min-w-0 whitespace-pre-wrap break-words text-xs text-muted-foreground', className)}>
        {initialNotes}
      </span>
    );
  }

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      await transactionAPI.updateNotes(transactionId, draft);
      onUpdate(draft);
      onEditingChange(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not save the note. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className={cn('block w-full max-w-md space-y-1.5', className)}>
      <Textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        placeholder="What should you remember about this?"
        aria-label="Note"
        rows={compact ? 2 : 3}
        maxLength={500}
        aria-invalid={Boolean(error)}
        className="min-h-0 resize-none text-sm"
      />

      {error && <span className="block text-xs text-terra">{error}</span>}

      <span className="flex items-center gap-2">
        <Button size="xs" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setDraft(initialNotes);
            setError(null);
            onEditingChange(false);
          }}
        >
          Cancel
        </Button>
      </span>
    </span>
  );
};

interface NoteTriggerProps {
  label?: string;
  onClick: () => void;
  /** Phone rows have no hover, so the trigger is always readable there. */
  alwaysVisible?: boolean;
  className?: string;
}

/** The quiet "Add a note" on the name line: no height of its own, shown on hover or focus. */
export const NoteTrigger: React.FC<NoteTriggerProps> = ({
  label = 'Add a note',
  onClick,
  alwaysVisible = false,
  className,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'shrink-0 whitespace-nowrap rounded-sm text-xs text-muted-foreground/60 underline-offset-4 transition-opacity hover:text-ink hover:underline focus-visible:opacity-100',
      !alwaysVisible && 'md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100',
      className
    )}
  >
    {label}
  </button>
);
