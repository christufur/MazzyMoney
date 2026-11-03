import React, { useState } from 'react';
import { transactionAPI } from '../../services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface TransactionNotesProps {
  transactionId: string;
  initialNotes?: string;
  onUpdate: (notes: string) => void;
  compact?: boolean;
  className?: string;
}

/**
 * A note on a ledger row: one quiet line when there is something to say, and a muted
 * "Add a note" link that shows on hover (or on touch, where there is no hover).
 * Editing stays inline with a small Save and Cancel.
 */
export const TransactionNotes: React.FC<TransactionNotesProps> = ({
  transactionId,
  initialNotes = '',
  onUpdate,
  compact = false,
  className,
}) => {
  const [notes, setNotes] = useState(initialNotes);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await transactionAPI.updateNotes(transactionId, notes);
      onUpdate(notes);
      setIsEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not save the note. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setNotes(initialNotes);
    setError(null);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <span className={cn('block w-full max-w-md space-y-1.5 pt-1.5', className)}>
        <Textarea
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="What should you remember about this?"
          aria-label="Note"
          rows={compact ? 2 : 3}
          maxLength={500}
          aria-invalid={Boolean(error)}
          className="min-h-0 resize-none text-sm"
        />

        {error && <span className="block text-xs text-terra">{error}</span>}

        <span className="flex items-center gap-2">
          <Button size="xs" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="xs" variant="ghost" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
        </span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs', className)}>
      {notes && (
        <span className="min-w-0 whitespace-pre-wrap break-words text-muted-foreground">{notes}</span>
      )}
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="shrink-0 rounded-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
      >
        {notes ? 'Edit note' : 'Add a note'}
      </button>
    </span>
  );
};
