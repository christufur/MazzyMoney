import React, { useState } from 'react';
import { transactionAPI } from '../../services/api';

interface TransactionNotesProps {
  transactionId: string;
  initialNotes?: string;
  onUpdate: (notes: string) => void;
  compact?: boolean;
}

export const TransactionNotes: React.FC<TransactionNotesProps> = ({
  transactionId,
  initialNotes = '',
  onUpdate,
  compact = false
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
      setError(err.response?.data?.error || 'Failed to save notes');
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
      <div className="space-y-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes..."
          className={`w-full p-2 border rounded-md resize-none ${
            compact ? 'text-sm' : 'text-base'
          } ${error ? 'border-red-500' : 'border-gray-300'}`}
          rows={compact ? 2 : 3}
          maxLength={500}
        />
        {error && (
          <p className="text-red-500 text-xs">{error}</p>
        )}
        <div className="flex space-x-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 ${
              compact ? 'px-2 py-1 text-xs' : ''
            }`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            className={`px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400 ${
              compact ? 'px-2 py-1 text-xs' : ''
            }`}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notes ? (
        <div className={`p-2 bg-gray-50 rounded-md ${compact ? 'text-sm' : 'text-base'}`}>
          <p className="text-gray-700 whitespace-pre-wrap">{notes}</p>
        </div>
      ) : (
        <p className={`text-gray-400 italic ${compact ? 'text-sm' : 'text-base'}`}>
          No notes
        </p>
      )}
      <button
        onClick={() => setIsEditing(true)}
        className={`text-blue-600 hover:text-blue-800 ${
          compact ? 'text-xs' : 'text-sm'
        }`}
      >
        {notes ? 'Edit notes' : 'Add notes'}
      </button>
    </div>
  );
};
