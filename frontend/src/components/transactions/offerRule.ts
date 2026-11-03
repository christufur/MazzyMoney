import { toast } from 'sonner';
import { rulesAPI } from '../../services/api';

interface OfferRuleArgs {
  transactionId: string;
  /** The name as the reader sees it, so the toast speaks their words. */
  merchant: string;
  category: string;
  /** Called after a rule is saved and applied, so the page can show the new categories. */
  onApplied?: () => void;
}

/**
 * Monarch-style follow-up: one category fix can become a rule for this merchant,
 * past and future. Shared by the list and the review queue so both offer it the same way.
 */
export const offerRule = ({ transactionId, merchant, category, onApplied }: OfferRuleArgs) => {
  toast(`${merchant} is now ${category}.`, {
    duration: 8000,
    action: {
      label: 'Always do this',
      onClick: async () => {
        try {
          const { rule, matchCount } = await rulesAPI.fromTransaction(transactionId, category);
          const result = matchCount > 0 ? await rulesAPI.apply(rule.id) : { updated: 0, skippedUserCategory: 0 };
          toast.success(
            result.updated > 0
              ? `Rule saved. ${result.updated} past transaction${result.updated === 1 ? '' : 's'} updated.`
              : 'Rule saved. It applies to new transactions.'
          );
          onApplied?.();
        } catch (err: any) {
          toast.error(err.response?.data?.error || 'Could not save the rule. Try again from the Rules page.');
        }
      },
    },
  });
};
