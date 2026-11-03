import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import SidebarLayout from '../components/layout/SidebarLayout';
import { accountAPI, categoryAPI, rulesAPI } from '../services/api';
import type {
  AccountListItem,
  Rule,
  RuleApplyResult,
  RuleDraft,
  RulePreview,
  RuleWithMatchCount,
} from '../services/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { money, moneyWhole } from '@/lib/money';

/** The account Select and the category Select both need a "leave it alone" choice. */
const ANY_ACCOUNT = 'any';
const NO_CATEGORY = 'none';
const PREVIEW_DEBOUNCE_MS = 400;
/** The preview returns up to ten rows; five is enough to recognise a rule at a glance. */
const PREVIEW_ROWS_SHOWN = 5;

interface AccountOption {
  id: string;
  /** Name plus mask, the way the account reads elsewhere in the app. */
  label: string;
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const matchCountLabel = (count: number) =>
  count === 0 ? 'Matches no transactions' : `Matches ${count} transaction${count === 1 ? '' : 's'}`;

/** The toast after a rule lands on old rows; the numbers come from the apply response. */
const applyMessage = ({ updated, skippedUserCategory }: RuleApplyResult) => {
  if (updated === 0 && skippedUserCategory === 0) return 'No past transactions match this rule.';

  const updatedLine =
    updated > 0
      ? `Updated ${updated} transaction${updated === 1 ? '' : 's'}.`
      : 'Nothing changed.';

  return skippedUserCategory > 0
    ? `${updatedLine} ${skippedUserCategory} kept your own category.`
    : updatedLine;
};

/** Empty and unparseable both read as "not set"; save does its own stricter check. */
const amountValue = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasCondition = (draft: RuleDraft) =>
  Boolean(draft.matchMerchant) ||
  draft.matchAmountMin !== null ||
  draft.matchAmountMax !== null ||
  Boolean(draft.matchAccountId);

const hasAction = (draft: RuleDraft) =>
  Boolean(draft.setCategory) ||
  Boolean(draft.setMerchant) ||
  draft.setTransfer === true ||
  draft.setHidden === true;

const Emphasis: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="font-medium text-ink">{children}</span>
);

/**
 * One rule as the sentence it is: "When merchant contains Starbucks → category
 * Food & Dining, rename to Starbucks". Conditions join with "and"; the account
 * attaches with "on"; actions join with commas.
 */
const RuleSentence: React.FC<{ rule: Rule; accounts: AccountOption[] }> = ({ rule, accounts }) => {
  const conditions: React.ReactNode[] = [];

  if (rule.matchMerchant) {
    conditions.push(<>merchant contains <Emphasis>{rule.matchMerchant}</Emphasis></>);
  }

  const min = rule.matchAmountMin;
  const max = rule.matchAmountMax;
  if (min !== null && max !== null) {
    conditions.push(
      min === max ? (
        <>amount {moneyWhole(min)}</>
      ) : (
        <>amount {moneyWhole(min)}–{moneyWhole(max)}</>
      )
    );
  } else if (min !== null) {
    conditions.push(<>amount {moneyWhole(min)} and up</>);
  } else if (max !== null) {
    conditions.push(<>amount up to {moneyWhole(max)}</>);
  }

  const actions: React.ReactNode[] = [];
  if (rule.setCategory) actions.push(<>category <Emphasis>{rule.setCategory}</Emphasis></>);
  if (rule.setMerchant) actions.push(<>rename to <Emphasis>{rule.setMerchant}</Emphasis></>);
  if (rule.setTransfer) actions.push(<>mark as transfer</>);
  if (rule.setHidden) actions.push(<>hide</>);

  const account = accounts.find((candidate) => candidate.id === rule.matchAccountId) ?? null;
  // An account can be removed (its Item was unlinked); say so rather than quietly
  // dropping the condition from the sentence.
  const accountLabel = rule.matchAccountId
    ? account?.label ?? 'an account you no longer have'
    : null;

  return (
    <p className="text-[15px] leading-relaxed">
      {conditions.length === 0 ? (
        'All transactions'
      ) : (
        <>
          When{' '}
          {conditions.map((condition, index) => (
            <React.Fragment key={index}>
              {index > 0 && ' and '}
              {condition}
            </React.Fragment>
          ))}
        </>
      )}
      {accountLabel && <> on {accountLabel}</>}
      {actions.length === 0 ? (
        <> → no change</>
      ) : (
        <>
          {' → '}
          {actions.map((action, index) => (
            <React.Fragment key={index}>
              {index > 0 && ', '}
              {action}
            </React.Fragment>
          ))}
        </>
      )}
    </p>
  );
};

const RuleRow: React.FC<{
  rule: RuleWithMatchCount;
  accounts: AccountOption[];
  applying: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ rule, accounts, applying, onApply, onEdit, onDelete }) => (
  <li className="ledger-line px-6 py-5 last:border-b-0">
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0">
        <RuleSentence rule={rule} accounts={accounts} />
        <p className="mt-1 text-sm text-muted-foreground">{matchCountLabel(rule.matchCount)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:shrink-0">
        <Button variant="outline" size="sm" onClick={onApply} disabled={applying}>
          {applying ? 'Applying…' : 'Apply to past transactions'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm">
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
              <AlertDialogDescription>
                This rule stops running on new transactions. The transactions it already changed
                stay as they are.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  </li>
);

interface RuleDialogProps {
  /** The rule to edit, or null for a new one. */
  rule: Rule | null;
  accounts: AccountOption[];
  categories: string[];
  onClose: () => void;
  /** The list behind the dialog, refetched after a save so it never goes stale. */
  onSaved: () => Promise<void>;
}

const RuleDialog: React.FC<RuleDialogProps> = ({ rule, accounts, categories, onClose, onSaved }) => {
  const [merchant, setMerchant] = useState(rule?.matchMerchant ?? '');
  const [amountMin, setAmountMin] = useState(
    rule?.matchAmountMin != null ? String(rule.matchAmountMin) : ''
  );
  const [amountMax, setAmountMax] = useState(
    rule?.matchAmountMax != null ? String(rule.matchAmountMax) : ''
  );
  // A rule can point at an account that was removed with its bank. The list cannot show it and
  // the server refuses an id it does not own, so it starts on "Any account" with a note.
  const missingAccount = Boolean(
    rule?.matchAccountId && !accounts.some((account) => account.id === rule.matchAccountId)
  );
  const [accountId, setAccountId] = useState(rule?.matchAccountId && !missingAccount ? rule.matchAccountId : ANY_ACCOUNT);
  const [category, setCategory] = useState(rule?.setCategory ?? NO_CATEGORY);
  const [renameTo, setRenameTo] = useState(rule?.setMerchant ?? '');
  const [transfer, setTransfer] = useState(rule?.setTransfer === true);
  const [hidden, setHidden] = useState(rule?.setHidden === true);
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));

  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  /** Set once the rule is written and it still has past rows to reach. */
  const [saved, setSaved] = useState<{ rule: Rule; matchCount: number } | null>(null);

  /** Everything that decides what the rule reaches; priority is not part of the match. */
  const matchDraft = useMemo<RuleDraft>(
    () => ({
      matchMerchant: merchant.trim() === '' ? null : merchant.trim(),
      matchAmountMin: amountValue(amountMin),
      matchAmountMax: amountValue(amountMax),
      matchAccountId: accountId === ANY_ACCOUNT ? null : accountId,
      setCategory: category === NO_CATEGORY ? null : category,
      setMerchant: renameTo.trim() === '' ? null : renameTo.trim(),
      setTransfer: transfer ? true : null,
      setHidden: hidden ? true : null,
    }),
    [merchant, amountMin, amountMax, accountId, category, renameTo, transfer, hidden]
  );

  const draft = useMemo<RuleDraft>(() => {
    const parsedPriority = Number(priority);
    return {
      priority: priority.trim() !== '' && Number.isFinite(parsedPriority) ? parsedPriority : 0,
      ...matchDraft,
    };
  }, [priority, matchDraft]);

  /** The backend needs one of each; only ask for a count once the draft is a rule. */
  const ready = hasCondition(matchDraft) && hasAction(matchDraft);

  useEffect(() => {
    if (!ready) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let active = true;
    // A count from the previous draft would be a lie while the next one is being checked.
    setPreview(null);
    const timer = setTimeout(() => {
      rulesAPI
        .preview(matchDraft)
        .then((result) => {
          if (!active) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((err: any) => {
          if (!active) return;
          setPreview(null);
          setPreviewError(err.response?.data?.error || 'Could not check past transactions.');
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [matchDraft, ready]);

  const accountLabel = accounts.find((candidate) => candidate.id === accountId)?.label;
  const categoryLabel = category === NO_CATEGORY ? 'Do not change' : category;

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    for (const [value, which] of [[amountMin, 'from'], [amountMax, 'to']] as Array<[string, string]>) {
      if (value.trim() === '') continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        setFormError(`Enter a number for the amount ${which}.`);
        return;
      }
      if (parsed < 0) {
        setFormError(`The amount ${which} cannot be below zero.`);
        return;
      }
    }

    try {
      setSaving(true);
      const response = rule
        ? await rulesAPI.update(rule.id, draft)
        : await rulesAPI.create(draft);

      // A fresh count for the "apply to past transactions" question. The last preview may
      // never have run, and an edit can change how many rows the rule reaches.
      let matchCount = 0;
      try {
        matchCount = (await rulesAPI.preview(matchDraft)).matchCount;
      } catch {
        matchCount = preview?.matchCount ?? 0;
      }

      await onSaved();

      if (matchCount > 0) setSaved({ rule: response.rule, matchCount });
      else onClose();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Could not save this rule. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyNow = async () => {
    if (!saved) return;

    try {
      setApplying(true);
      setFormError(null);
      const result = await rulesAPI.apply(saved.rule.id);
      await onSaved();
      toast.success(applyMessage(result));
      onClose();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Could not apply this rule. Try again.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !saving && !applying) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {saved ? (
          <>
            <DialogHeader>
              <DialogTitle>Rule saved</DialogTitle>
              <DialogDescription>It runs on every new transaction from now on.</DialogDescription>
            </DialogHeader>

            <p className="text-[15px]">
              Apply this rule to the {saved.matchCount} past transaction
              {saved.matchCount === 1 ? '' : 's'} too?
            </p>
            <p className="text-sm text-muted-foreground">
              Transactions you categorised yourself keep your choice.
            </p>

            {formError && (
              <p role="alert" className="text-sm text-terra">
                {formError}
              </p>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={applying}>
                Only new transactions
              </Button>
              <Button onClick={handleApplyNow} disabled={applying}>
                {applying ? 'Applying…' : 'Apply now'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{rule ? 'Edit rule' : 'New rule'}</DialogTitle>
              <DialogDescription>
                {rule
                  ? 'Change what this rule matches or what it does. Past transactions change only when you apply it again.'
                  : 'Set what to look for, then what should happen when it matches.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSave} className="space-y-6">
              <div role="group" aria-labelledby="rule-when">
                <h3 id="rule-when" className="section-label mb-3">
                  When
                </h3>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rule-merchant">Merchant contains</Label>
                    <Input
                      id="rule-merchant"
                      value={merchant}
                      maxLength={100}
                      autoComplete="off"
                      placeholder="Starbucks"
                      onChange={(event) => setMerchant(event.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="rule-amount-min">Amount from</Label>
                      <Input
                        id="rule-amount-min"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={amountMin}
                        onChange={(event) => setAmountMin(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rule-amount-max">Amount to</Label>
                      <Input
                        id="rule-amount-max"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="No limit"
                        value={amountMax}
                        onChange={(event) => setAmountMax(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span id="rule-account-label" className="text-sm font-medium">
                      Account
                    </span>
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger
                        id="rule-account"
                        aria-labelledby="rule-account-label"
                        className="w-full"
                      >
                        <span className="truncate">{accountLabel ?? 'Any account'}</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY_ACCOUNT}>Any account</SelectItem>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {missingAccount && (
                      <p className="text-xs text-muted-foreground">
                        This rule matched an account that is no longer connected. Choose an account
                        or leave it on any.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div role="group" aria-labelledby="rule-then">
                <h3 id="rule-then" className="section-label mb-3">
                  Then
                </h3>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <span id="rule-category-label" className="text-sm font-medium">
                      Category
                    </span>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger
                        id="rule-category"
                        aria-labelledby="rule-category-label"
                        className="w-full"
                      >
                        <span className="truncate">{categoryLabel}</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>Do not change</SelectItem>
                        {categories.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="rule-rename">Rename to</Label>
                    <Input
                      id="rule-rename"
                      value={renameTo}
                      maxLength={80}
                      autoComplete="off"
                      placeholder="Leave blank to keep it"
                      onChange={(event) => setRenameTo(event.target.value)}
                    />
                  </div>

                  <div className="space-y-3 pt-1">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="rule-transfer"
                        checked={transfer}
                        onCheckedChange={(checked) => setTransfer(checked === true)}
                      />
                      <Label htmlFor="rule-transfer" className="font-normal">
                        Mark as transfer
                      </Label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="rule-hidden"
                        checked={hidden}
                        onCheckedChange={(checked) => setHidden(checked === true)}
                      />
                      <Label htmlFor="rule-hidden" className="font-normal">
                        Hide from totals
                      </Label>
                    </div>
                  </div>
                </div>
              </div>

              <details
                className="rounded-md border border-rule px-4 py-3"
                open={(rule?.priority ?? 0) !== 0}
              >
                <summary className="cursor-pointer text-sm text-muted-foreground">Advanced</summary>
                <div className="mt-3 flex items-center gap-3">
                  <Label htmlFor="rule-priority" className="font-normal">
                    Priority
                  </Label>
                  <Input
                    id="rule-priority"
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">Higher runs first.</span>
                </div>
              </details>

              <div className="rounded-md bg-paper px-4 py-3" aria-live="polite">
                {!ready ? (
                  <p className="text-sm text-muted-foreground">
                    Add a condition and an action to see what this rule matches.
                  </p>
                ) : previewError ? (
                  <p className="text-sm text-terra">{previewError}</p>
                ) : preview ? (
                  <>
                    <p className="text-sm font-medium">{matchCountLabel(preview.matchCount)}</p>
                    {preview.sample.length > 0 && (
                      <ul className="mt-2">
                        {preview.sample.slice(0, PREVIEW_ROWS_SHOWN).map((sample) => (
                          <li
                            key={sample.id}
                            className="ledger-line grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-sm last:border-b-0"
                          >
                            <span className="text-muted-foreground">{shortDate(sample.date)}</span>
                            <span className="truncate">{sample.merchantName ?? sample.name}</span>
                            <span
                              className={
                                sample.amount < 0
                                  ? 'text-right tabular-nums text-sage-ink'
                                  : 'text-right tabular-nums'
                              }
                            >
                              {sample.amount < 0 ? `+${money(-sample.amount)}` : `−${money(sample.amount)}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Checking…</p>
                )}
              </div>

              {formError && (
                <p role="alert" className="text-sm text-terra">
                  {formError}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : rule ? 'Save changes' : 'Save rule'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Rules: React.FC = () => {
  const [rules, setRules] = useState<RuleWithMatchCount[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  /** `silent` refetches behind a dialog without flashing the page skeletons. */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const [rulesResponse, accountsResponse, categoriesResponse] = await Promise.all([
        rulesAPI.list(),
        accountAPI.getAccounts(),
        categoryAPI.getAll(),
      ]);

      setRules(rulesResponse.rules ?? []);
      setAccounts(
        ((accountsResponse.accounts ?? []) as AccountListItem[]).map((account) => ({
          id: account.id,
          label: account.mask ? `${account.name} ••${account.mask}` : account.name,
        }))
      );
      setCategories(categoriesResponse.categories ?? []);
    } catch (err: any) {
      // A background refetch failing must not replace a list the user can still use; the
      // action that triggered it reports its own result.
      if (silent) return;
      setError(
        err.response?.data?.error ||
          'Could not load your rules. Check that the server is running, then try again.'
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (rule: Rule) => {
    setEditing(rule);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const handleApply = async (rule: RuleWithMatchCount) => {
    try {
      setApplyingId(rule.id);
      const result = await rulesAPI.apply(rule.id);
      toast.success(applyMessage(result));
      // Counts come from the server, so ask again rather than trusting the last load.
      await load(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not apply this rule. Try again.');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async (rule: RuleWithMatchCount) => {
    try {
      await rulesAPI.remove(rule.id);
      setRules((current) => current.filter((candidate) => candidate.id !== rule.id));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not delete this rule. Try again.');
    }
  };

  return (
    <SidebarLayout title="Rules">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <p className="max-w-xl text-[15px] text-muted-foreground">
          Rules run on every new transaction. Your own category choices always win.
        </p>
        <Button onClick={openNew}>New rule</Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra"
        >
          {error}
          <Button variant="outline" size="sm" onClick={() => load()}>
            Try again
          </Button>
        </div>
      )}

      {loading ? (
        <div className="sheet space-y-4 px-6 py-5" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : error ? null : rules.length === 0 ? (
        <div className="sheet px-6 py-14 text-center">
          <p className="mx-auto max-w-md text-[15px]">
            No rules yet. A rule saves you from fixing the same merchant every month.
          </p>
          <Button className="mt-5" onClick={openNew}>
            New rule
          </Button>
        </div>
      ) : (
        <section aria-label="Rules">
          <div className="sheet">
            <div className="flex items-baseline justify-between gap-4 border-b border-rule px-6 py-3.5">
              <h2 className="section-label">
                {rules.length} rule{rules.length === 1 ? '' : 's'}
              </h2>
              <span className="text-xs text-muted-foreground">Highest priority first</span>
            </div>
            <ul>
              {rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  accounts={accounts}
                  applying={applyingId === rule.id}
                  onApply={() => handleApply(rule)}
                  onEdit={() => openEdit(rule)}
                  onDelete={() => handleDelete(rule)}
                />
              ))}
            </ul>
          </div>
        </section>
      )}

      {dialogOpen && (
        <RuleDialog
          key={editing?.id ?? 'new'}
          rule={editing}
          accounts={accounts}
          categories={categories}
          onClose={closeDialog}
          onSaved={() => load(true)}
        />
      )}
    </SidebarLayout>
  );
};

export default Rules;
