import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import SidebarLayout from '../components/layout/SidebarLayout';
import { budgetAPI, monthNoteAPI, transactionAPI, type Budget, type MonthNote } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { addMonths, moneyWhole, monthKey, monthName, rangeFor } from '@/lib/money';
import { reflectOnMonth } from '@/lib/reflection';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const closedOn = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const Figure: React.FC<{ label: string; value: string; tone?: 'sage' }> = ({ label, value, tone }) => (
  <div className="border-b border-rule pb-3">
    <div className="text-sm text-muted-foreground">{label}</div>
    <div className={cn('mt-1 text-figure font-semibold tabular-nums', tone === 'sage' && 'text-sage-ink')}>{value}</div>
  </div>
);

/** One budget line as the month ended: what was spent against what was there, and the difference. */
const BudgetResult: React.FC<{ b: Budget }> = ({ b }) => {
  const diff = b.available - b.spent;
  return (
    <li className="ledger-line grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-3 text-[15px] sm:grid-cols-[minmax(0,1fr)_auto_7rem]">
      <span className="truncate">{b.category}</span>
      <span className="text-right tabular-nums text-muted-foreground">
        <span className="text-ink">{moneyWhole(b.spent)}</span> / {moneyWhole(b.available)}
      </span>
      <span className={cn('col-span-2 text-sm tabular-nums sm:col-span-1 sm:text-right sm:text-[15px]', diff < 0 ? 'text-terra' : 'text-muted-foreground')}>
        {diff < 0 ? `${moneyWhole(-diff)} over` : `${moneyWhole(diff)} left`}
      </span>
    </li>
  );
};

const CloseMonthPage: React.FC = () => {
  const { month = '' } = useParams();
  const valid = MONTH.test(month) && month < monthKey(new Date());
  const next = valid ? addMonths(month, 1) : '';
  const name = valid ? monthName(month, false) : '';
  const nextName = valid ? monthName(next, false) : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({ income: 0, expenses: 0 });
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [record, setRecord] = useState<MonthNote | null>(null);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const [tx, prevTx, budgetRes, mine, nextRecord] = await Promise.all([
        transactionAPI.getTransactions({ ...rangeFor(month), limit: 1 }),
        transactionAPI.getTransactions({ ...rangeFor(addMonths(month, -1)), limit: 1 }),
        budgetAPI.getBudgets(month),
        monthNoteAPI.get(month),
        monthNoteAPI.get(next),
      ]);
      setSummary({ income: tx.summary?.income ?? 0, expenses: tx.summary?.expenses ?? 0 });
      setLastSaved(prevTx.summary ? (prevTx.summary.income ?? 0) - (prevTx.summary.expenses ?? 0) : null);
      setBudgets(budgetRes.budgets ?? []);
      setRecord(mine);
      setNote(mine.note ?? '');
      setTarget(nextRecord.savingsTarget != null ? String(nextRecord.savingsTarget) : '');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not load this month. Check that the server is running, then try again.');
    } finally {
      setLoading(false);
    }
  }, [valid, month, next]);

  useEffect(() => { load(); }, [load]);

  if (!valid) return <Navigate to="/overview" replace />;

  const saved = summary.income - summary.expenses;
  const targetValue = target.trim() === '' ? null : Number(target);
  const targetInvalid = targetValue !== null && (!Number.isFinite(targetValue) || targetValue < 0);
  const closed = Boolean(record?.closedAt);

  const reflection = reflectOnMonth({
    isCurrentMonth: false,
    monthLabel: name,
    nextMonthLabel: nextName,
    income: summary.income,
    spent: summary.expenses,
    lastMonthSaved: lastSaved,
    overLines: budgets.map((b) => ({ category: b.category, over: b.spent - b.available, rollover: b.rollover })),
    hasBudgets: budgets.length > 0,
    savingsTarget: record?.savingsTarget,
  });
  const over = budgets.filter((b) => b.spent > b.available);
  const onPlan = budgets.filter((b) => b.spent <= b.available);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (targetInvalid) return;
    setSaving(true);
    try {
      const [mine] = await Promise.all([
        monthNoteAPI.save(month, { note, closed: true }),
        monthNoteAPI.save(next, { savingsTarget: targetValue }),
      ]);
      setRecord(mine);
      toast.success(closed ? 'Changes saved.' : `${name} closed.`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidebarLayout title={`Close ${name}`} showTitle={false}>
      <div className="mb-8 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/overview" aria-label="Back to the month"><ChevronLeft /></Link>
        </Button>
        <div>
          <h1 className="text-title font-semibold text-ink">Close {monthName(month)}</h1>
          <p className="text-sm text-muted-foreground">
            {closed ? `Closed ${closedOn(record!.closedAt!)}` : 'Look back once, write it down, set the next target.'}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-md bg-terra-tint px-4 py-3 text-sm text-terra">
          {error}
          <Button variant="outline" size="sm" onClick={load}>Try again</Button>
        </div>
      )}

      <form onSubmit={save} aria-label={`Close ${name}`} className="sheet md:grid md:grid-cols-2">
        <div>
          <section aria-label="What came in and went out" className="p-6 md:p-8">
            {loading ? <Skeleton className="h-20" /> : (
              <div className="grid grid-cols-3 gap-5">
                <Figure label="Came in" value={moneyWhole(summary.income)} />
                <Figure label="Went out" value={moneyWhole(summary.expenses)} />
                <Figure
                  label={saved >= 0 ? 'Saved' : 'Net'}
                  value={saved >= 0 ? moneyWhole(saved) : `−${moneyWhole(-saved)}`}
                  tone={saved > 0 ? 'sage' : undefined}
                />
              </div>
            )}
            {!loading && (
              <p className="mt-6 rounded-md bg-paper px-5 py-4 text-[15px] leading-relaxed">{reflection}</p>
            )}
          </section>

          <section aria-label="Budgets" className="border-t border-rule p-6 md:p-8">
            <h2 className="section-label mb-1">Budgets</h2>
            {loading ? <Skeleton className="mt-3 h-32" /> : budgets.length === 0 ? (
              <p className="mt-3 text-[15px] text-muted-foreground">No budgets were planned for {name}.</p>
            ) : (
              <ul>{[...over, ...onPlan].map((b) => <BudgetResult key={b.id} b={b} />)}</ul>
            )}
          </section>
        </div>

        <div className="border-t border-rule p-6 md:border-l md:border-t-0 md:p-8">
          <div className="space-y-2">
            <Label htmlFor="month-note">What would you keep or change?</Label>
            <Textarea
              id="month-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={6}
              placeholder={`A line or two about ${name}, for future you.`}
              disabled={loading}
            />
          </div>

          <div className="mt-6 space-y-2">
            <Label htmlFor="savings-target">Savings target for {nextName}</Label>
            <div className="relative max-w-[12rem]">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="savings-target"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={saved > 0 ? String(Math.round(saved)) : '0'}
                className="pl-7 tabular-nums"
                aria-invalid={targetInvalid || undefined}
                aria-describedby="savings-target-help"
                disabled={loading}
              />
            </div>
            <p id="savings-target-help" className={cn('text-sm', targetInvalid ? 'text-terra' : 'text-muted-foreground')}>
              {targetInvalid ? 'Enter an amount of 0 or more.' : `${nextName}'s overview measures savings against this. Leave it empty for no target.`}
            </p>
          </div>

          <Button type="submit" className="mt-8 w-full sm:w-auto" disabled={loading || saving || targetInvalid}>
            {closed ? 'Save changes' : `Close ${name}`}
          </Button>
        </div>
      </form>
    </SidebarLayout>
  );
};

export default CloseMonthPage;
