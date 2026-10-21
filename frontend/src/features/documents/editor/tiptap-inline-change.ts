import type { Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "@tiptap/pm/transform";

/** Changes inside one textblock cannot create IDs or change child kinds.
 * Structural paste/split/join, node attributes and unknown steps stay slow. */
export function inlineTransactionsOnly(transactions: readonly Transaction[]): boolean {
  return transactions.every(transaction => transaction.steps.every((step, index) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
    if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return false;
    const before = transaction.docs[index];
    const from = before.resolve(step.from), to = before.resolve(step.to);
    if (!from.sameParent(to) || !from.parent.isTextblock) return false;
    let inline = true;
    step.slice.content.forEach(node => { if (!node.isInline) inline = false; });
    return inline;
  }));
}
