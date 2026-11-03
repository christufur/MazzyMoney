import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { accountAPI } from '../../services/api';
import type { AccountListItem, ManualAccountKind } from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { money } from '@/lib/money';

/**
 * Manual accounts are for the things Plaid does not connect well or cheaply:
 * the 401(k), cars, the house, and cash. Each one uses no Plaid Item.
 */
const KIND_OPTIONS: Array<{ value: ManualAccountKind; label: string }> = [
  { value: 'retirement', label: 'Retirement (401k, IRA)' },
  { value: 'investment', label: 'Investment' },
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'cash', label: 'Cash' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

const kindLabel = (kind: string) => {
  const option = KIND_OPTIONS.find((candidate) => candidate.value === kind);
  return option ? option.label : kind.replace(/_/g, ' ');
};

/** Assets read plain; money owed reads with a real minus in ink. */
const signedBalance = (account: AccountListItem) => {
  const amount = account.isLiability ? -Math.abs(account.balances.current) : account.balances.current;
  return amount < 0 ? `−${money(Math.abs(amount))}` : money(amount);
};

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const errorMessage = (err: any, fallback = 'Something went wrong. Try again.') => {
  const serverError = err?.response?.data?.error;
  return typeof serverError === 'string' && serverError.trim() ? serverError : fallback;
};

interface RowProps {
  account: AccountListItem;
  onSaved: () => Promise<void>;
  onDelete: (account: AccountListItem) => void;
  deleting: boolean;
}

/** One ledger row. "Update balance" opens an inline amount plus an optional past date. */
const AccountRow: React.FC<RowProps> = ({ account, onSaved, onDelete, deleting }) => {
  const [editing, setEditing] = useState(false);
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(todayIsoDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setBalance(String(account.balances.current));
    setDate(todayIsoDate());
    setError(null);
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    const parsed = Number(balance);
    if (balance.trim() === '' || !Number.isFinite(parsed)) {
      setError('Enter a number for the balance.');
      return;
    }
    if (date > todayIsoDate()) {
      setError('The date cannot be in the future.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await accountAPI.updateManualBalance(
        account.id,
        parsed,
        date === todayIsoDate() ? undefined : date
      );
      setEditing(false);
      await onSaved();
    } catch (err: any) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="ledger-line py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] text-ink">{account.name}</p>
          <p className="text-xs text-muted-foreground">{kindLabel(account.type)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="tabular-nums text-ink">{signedBalance(account)}</span>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={open}>
              Update balance
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-terra hover:bg-terra-tint hover:text-terra"
            onClick={() => onDelete(account)}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-end gap-3 rounded-md bg-paper p-3">
          <div>
            <Label htmlFor={`balance-${account.id}`} className="mb-1 text-xs text-muted-foreground">
              New balance
            </Label>
            <Input
              id={`balance-${account.id}`}
              aria-label={`New balance for ${account.name}`}
              type="number"
              inputMode="decimal"
              step="0.01"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              className="w-36 tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor={`balance-date-${account.id}`} className="mb-1 text-xs text-muted-foreground">
              Date
            </Label>
            <Input
              id={`balance-date-${account.id}`}
              aria-label={`Balance date for ${account.name}`}
              type="date"
              value={date}
              max={todayIsoDate()}
              onChange={(event) => setDate(event.target.value)}
              className="w-40 tabular-nums"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="w-full text-sm text-terra">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
};

const ManualAccounts: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountListItem | null>(null);
  // A failed delete stays in the dialog with the buttons, not on the page behind it.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Add form: one dialog, fields reset when it opens.
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ManualAccountKind>('retirement');
  const [balance, setBalance] = useState('');
  const [isLiability, setIsLiability] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchManualAccounts = useCallback(async () => {
    try {
      setLoadError(null);
      const response = await accountAPI.getAccounts();
      const all: AccountListItem[] = response?.accounts ?? [];
      setAccounts(all.filter((account) => account.isManual));
    } catch (err: any) {
      setLoadError(errorMessage(err, 'Could not load your manual accounts. Try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchManualAccounts();
  }, [fetchManualAccounts]);

  const openAdd = () => {
    setName('');
    setKind('retirement');
    setBalance('');
    setIsLiability(false);
    setFormError(null);
    setAddOpen(true);
  };

  const handleKindChange = (value: ManualAccountKind) => {
    setKind(value);
    // A loan is a liability: check the box for it and uncheck it when leaving.
    setIsLiability(value === 'loan');
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 80) {
      setFormError('Enter a name of 1 to 80 characters.');
      return;
    }
    const parsedBalance = Number(balance);
    if (balance.trim() === '' || !Number.isFinite(parsedBalance)) {
      setFormError('Enter a number for the balance.');
      return;
    }

    try {
      setCreating(true);
      setFormError(null);
      await accountAPI.createManual({
        name: trimmedName,
        kind,
        balance: parsedBalance,
        isLiability,
      });
      setAddOpen(false);
      setName('');
      setKind('retirement');
      setBalance('');
      setIsLiability(false);
      await fetchManualAccounts();
    } catch (err: any) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (account: AccountListItem) => {
    try {
      setDeletingId(account.id);
      setDeleteError(null);
      await accountAPI.deleteManual(account.id);
      setDeleteTarget(null);
      await fetchManualAccounts();
    } catch (err: any) {
      setDeleteError(errorMessage(err, `Could not delete ${account.name}. Try again.`));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="sheet" aria-label="Manual accounts">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-6 md:p-8">
        <div className="min-w-0">
          <h2 className="section-label">Manual accounts</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            For accounts Plaid does not connect: 401(k), car, house, cash.
          </p>
        </div>
        <Button variant="outline" onClick={openAdd}>
          <Plus /> Add account
        </Button>
      </div>

      <div className="px-6 pb-6 md:px-8 md:pb-8">
        {loading ? (
          <>
            <span className="sr-only">Loading manual accounts</span>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="mt-2 h-14 w-full" />
          </>
        ) : (
          <>
            {loadError && (
              <div
                role="alert"
                className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
              >
                <span>{loadError}</span>
                <Button variant="outline" size="sm" onClick={() => fetchManualAccounts()}>
                  Try again
                </Button>
              </div>
            )}

            {accounts.length === 0 ? (
              loadError ? null : (
                <p className="text-[15px] text-muted-foreground">
                  No manual accounts yet. Add the 401(k), car, house, or cash.
                </p>
              )
            ) : (
              <ul>
                {accounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    onSaved={fetchManualAccounts}
                    onDelete={(account) => {
                      setDeleteError(null);
                      setDeleteTarget(account);
                    }}
                    deleting={deletingId === account.id}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Add a manual account</DialogTitle>
              <DialogDescription>
                For what Plaid does not connect: the 401(k), car, house, or cash.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="manual-name">Name</Label>
                <Input
                  id="manual-name"
                  type="text"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Fidelity 401(k)"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="manual-kind">Kind</Label>
                <Select value={kind} onValueChange={(value) => handleKindChange(value as ManualAccountKind)}>
                  <SelectTrigger id="manual-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="manual-balance">Balance</Label>
                <Input
                  id="manual-balance"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  placeholder="0.00"
                  className="tabular-nums"
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="manual-liability"
                  checked={isLiability}
                  onCheckedChange={(checked) => setIsLiability(checked === true)}
                />
                <Label htmlFor="manual-liability" className="text-sm">
                  This is money owed
                </Label>
              </div>

              {formError && (
                <p role="alert" className="text-sm text-terra">
                  {formError}
                </p>
              )}
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? 'Adding…' : 'Add account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its balance history will be deleted too.</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-terra">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(deletingId)}
              onClick={(event) => {
                // Keep the dialog open while the request runs; the list reloads first.
                event.preventDefault();
                if (deleteTarget) handleDelete(deleteTarget);
              }}
            >
              {deletingId ? 'Deleting…' : 'Delete account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default ManualAccounts;
