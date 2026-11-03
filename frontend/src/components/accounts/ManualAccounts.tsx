import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileUp, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { accountAPI } from '../../services/api';
import type {
  AccountListItem,
  CsvImportFormat,
  CsvImportMapping,
  CsvImportPreview,
  CsvImportResult,
  ManualAccountKind,
} from '../../services/api';
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
 * the 401(k), cars, the house, and cash. A manual card can also hold the charges
 * Plaid never sees, imported from the card's own CSV statement.
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

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* --- CSV import ---------------------------------------------------------- */

/** The header cells of the file, so "Other bank" can offer them as columns. */
export const csvHeaderRow = (csv: string): string[] => {
  const line = csv.split(/\r?\n/, 1)[0] ?? '';
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);

  return cells.map((value) => value.trim()).filter((value) => value.length > 0);
};

const NONE_COLUMN = '__none__';

interface ColumnMap {
  date: string;
  description: string;
  amount: string;
  merchant: string;
}

const EMPTY_COLUMNS: ColumnMap = { date: '', description: '', amount: '', merchant: '' };

/** A first guess from common header names; every guess is a Select the user can change. */
const guessColumns = (headers: string[]): ColumnMap => {
  const find = (...needles: string[]) =>
    headers.find((header) => {
      const lower = header.trim().toLowerCase();
      return needles.some((needle) => lower === needle || lower.includes(needle));
    }) ?? '';

  return {
    date: find('transaction date', 'date', 'posted'),
    description: find('description', 'name', 'memo', 'payee', 'details'),
    amount: find('amount', 'debit', 'charge'),
    merchant: find('merchant', 'payee') || '',
  };
};

const shortDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/**
 * One card statement at a time. The file is read in the browser and sent as text,
 * so the server sees exactly what the bank exported. A dry run always comes first:
 * the user sees the first five rows and the errors before anything is written.
 */
const CsvImportDialog: React.FC<{
  account: AccountListItem;
  onImported: () => Promise<void>;
}> = ({ account, onImported }) => {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [format, setFormat] = useState<CsvImportFormat>('apple-card');
  const [columns, setColumns] = useState<ColumnMap>(EMPTY_COLUMNS);
  const [negate, setNegate] = useState(false);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo(() => (csv ? csvHeaderRow(csv) : []), [csv]);

  const mapping = useMemo<CsvImportMapping | undefined>(() => {
    if (format !== 'generic') return undefined;
    if (!columns.date || !columns.description || !columns.amount) return undefined;
    return {
      date: columns.date,
      description: columns.description,
      amount: columns.amount,
      ...(columns.merchant ? { merchant: columns.merchant } : {}),
      ...(negate ? { negateAmount: true } : {}),
    };
  }, [format, columns, negate]);

  const ready = csv.length > 0 && (format === 'apple-card' || Boolean(mapping));

  const reset = () => {
    setCsv('');
    setFileName(null);
    setFormat('apple-card');
    setColumns(EMPTY_COLUMNS);
    setNegate(false);
    setPreview(null);
    setError(null);
    setChecking(false);
    setImporting(false);
  };

  const handleFile = async (file: File | undefined) => {
    setError(null);
    setPreview(null);
    if (!file) {
      setCsv('');
      setFileName(null);
      return;
    }

    try {
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
      // A new file gets fresh column guesses; the format choice is kept.
      setColumns(guessColumns(csvHeaderRow(text)));
    } catch {
      setCsv('');
      setFileName(null);
      setError('Could not read that file. Choose the CSV export again.');
    }
  };

  const handleFormat = (value: CsvImportFormat) => {
    setFormat(value);
    setPreview(null);
    setError(null);
  };

  // A dry run on every change: no button to forget, and the count is always current.
  useEffect(() => {
    if (!open || !ready) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    setChecking(true);
    setError(null);

    accountAPI
      .importCsv(account.id, {
        csv,
        format,
        ...(mapping ? { mapping } : {}),
        dryRun: true,
      })
      .then((result) => {
        if (!cancelled) setPreview(result as CsvImportPreview);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setPreview(null);
        setError(errorMessage(err, 'Could not read that file. Check that it is a CSV export, then try again.'));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, ready, csv, format, mapping, account.id]);

  const handleImport = async () => {
    if (!preview || preview.total === 0) return;

    try {
      setImporting(true);
      setError(null);
      const result = (await accountAPI.importCsv(account.id, {
        csv,
        format,
        ...(mapping ? { mapping } : {}),
      })) as CsvImportResult;

      toast.success(
        `Imported ${count(result.imported, 'transaction')}, skipped ${result.skipped} already imported.`,
        result.note ? { description: result.note } : undefined
      );
      setOpen(false);
      reset();
      await onImported();
    } catch (err: any) {
      setError(errorMessage(err, 'Could not import that file. Nothing was saved; try again.'));
    } finally {
      setImporting(false);
    }
  };

  const columnSelect = (
    label: string,
    key: keyof ColumnMap,
    placeholder: string,
    includeNone = false
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`import-${key}-${account.id}`}>{label}</Label>
      <Select
        value={columns[key] || (includeNone ? NONE_COLUMN : '')}
        onValueChange={(value) =>
          setColumns((current) => ({ ...current, [key]: value === NONE_COLUMN ? '' : value }))
        }
      >
        <SelectTrigger id={`import-${key}-${account.id}`} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {includeNone && <SelectItem value={NONE_COLUMN}>None</SelectItem>}
          {headers.map((header) => (
            <SelectItem key={header} value={header}>
              {header}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const previewRows = preview?.preview.slice(0, 5) ?? [];

  return (
    <>
      <Button variant="ghost" size="sm" className="text-ink" onClick={() => setOpen(true)}>
        <FileUp /> Import CSV
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import CSV into {account.name}</DialogTitle>
            <DialogDescription>
              Adds the card's charges as transactions. Rows already imported are skipped.
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-md bg-paper px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Apple Card: in the Wallet app, open the card, tap a monthly statement, then Export
            Transactions (CSV).
          </p>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`import-file-${account.id}`}>CSV file</Label>
              <Input
                id={`import-file-${account.id}`}
                type="file"
                accept=".csv"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={`import-format-${account.id}`}>Format</Label>
              <Select value={format} onValueChange={(value) => handleFormat(value as CsvImportFormat)}>
                <SelectTrigger id={`import-format-${account.id}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="apple-card">Apple Card</SelectItem>
                  <SelectItem value="generic">Other bank</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {format === 'generic' && (
              <>
                {csv.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Choose a file first; its column names appear here.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {columnSelect('Date column', 'date', 'Pick the date')}
                    {columnSelect('Description column', 'description', 'Pick the description')}
                    {columnSelect('Amount column', 'amount', 'Pick the amount')}
                    {columnSelect('Merchant column', 'merchant', 'None', true)}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`import-negate-${account.id}`}
                    checked={negate}
                    onCheckedChange={(checked) => setNegate(checked === true)}
                  />
                  <Label htmlFor={`import-negate-${account.id}`} className="text-sm">
                    Amounts are negative for purchases
                  </Label>
                </div>
              </>
            )}

            {checking && <p className="text-sm text-muted-foreground">Checking the file…</p>}

            {preview && !checking && (
              <div className="rounded-md border border-rule">
                <p className="border-b border-rule px-3 py-2 text-sm">
                  {preview.total === 0
                    ? 'Nothing to import in this file.'
                    : `${count(preview.total, 'transaction')} ready to import.`}
                </p>
                {previewRows.length > 0 && (
                  <ul>
                    {previewRows.map((row, index) => (
                      <li
                        key={`${row.date}-${row.description}-${index}`}
                        className="ledger-line grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-2 px-3 py-2 text-sm last:border-b-0"
                      >
                        <span className="text-muted-foreground">{shortDate(row.date)}</span>
                        <span className="min-w-0">
                          <span className="block truncate">{row.merchant ?? row.description}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.isTransfer ? 'Transfer · ' : ''}
                            {row.category}
                          </span>
                        </span>
                        <span className="text-right tabular-nums">{money(row.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {preview.preview.length > previewRows.length && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    First {previewRows.length} of {preview.preview.length} rows shown.
                  </p>
                )}
              </div>
            )}

            {preview && preview.errors.length > 0 && (
              <div role="alert" className="rounded-md bg-terra-tint px-3 py-2 text-sm text-terra">
                <p>{count(preview.errors.length, 'row')} could not be read.</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {preview.errors.slice(0, 3).map((row) => (
                    <li key={`${row.row}-${row.message}`}>
                      Row {row.row}: {row.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-md bg-terra-tint px-3 py-2 text-sm text-terra">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={!preview || preview.total === 0 || checking || importing}
            >
              {importing
                ? 'Importing…'
                : preview && preview.total > 0
                  ? `Import ${count(preview.total, 'transaction')}`
                  : 'Import transactions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/* --- rows --------------------------------------------------------------- */

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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mr-1 tabular-nums text-ink">{signedBalance(account)}</span>
          <CsvImportDialog account={account} onImported={onSaved} />
          {!editing && (
            <Button variant="ghost" size="sm" className="text-ink" onClick={open}>
              Update balance
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-ink"
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

/**
 * The manual accounts section. On Connections it is one section of the page's
 * single spread (`asSection`); on its own it keeps a sheet of its own.
 */
const ManualAccounts: React.FC<{ asSection?: boolean }> = ({ asSection = false }) => {
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
    <section
      aria-label="Manual accounts"
      className={asSection ? 'border-t border-rule p-6 md:p-8' : 'sheet p-6 md:p-8'}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="section-label">Manual accounts</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            For accounts Plaid does not connect: 401(k), car, house, cash.
          </p>
        </div>
        <Button variant="outline" size={asSection ? 'sm' : 'default'} onClick={openAdd}>
          <Plus /> Add account
        </Button>
      </div>

      <div className="mt-5">
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
                    onDelete={(target) => {
                      setDeleteError(null);
                      setDeleteTarget(target);
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
