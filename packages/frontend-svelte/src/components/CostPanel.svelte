<script lang="ts">
  /**
   * CostPanel - Displays cost estimation breakdown
   * Svelte 5 runes pattern
   */
  import type { CostEstimate, CostCategory } from '$lib/cost-types';
  import { CATEGORY_LABELS, CATEGORY_ORDER, formatCurrency } from '$lib/cost-types';

  // Props
  interface Props {
    estimate: CostEstimate | null;
    loading?: boolean;
  }
  let { estimate, loading = false }: Props = $props();

  // Computed: sorted categories with non-zero totals
  let activeCategories = $derived(
    estimate
      ? CATEGORY_ORDER.filter(cat => (estimate.subtotals[cat] ?? 0) > 0)
      : []
  );

  // Expand/collapse state
  let expandedCategories = $state<Set<CostCategory>>(new Set());

  function toggleCategory(cat: CostCategory) {
    if (expandedCategories.has(cat)) {
      expandedCategories.delete(cat);
      expandedCategories = new Set(expandedCategories);
    } else {
      expandedCategories.add(cat);
      expandedCategories = new Set(expandedCategories);
    }
  }

  function getCategoryItems(cat: CostCategory) {
    return estimate?.lineItems.filter(item => item.category === cat) ?? [];
  }
</script>

<div class="cost-panel h-full flex flex-col bg-white border-l border-gray-200">
  <header class="px-4 py-3 border-b border-gray-200">
    <h2 class="text-lg font-semibold text-gray-900">Cost Estimate</h2>
    {#if estimate}
      <p class="text-sm text-gray-500">
        {estimate.lineItems.length} line items
      </p>
    {/if}
  </header>

  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-gray-500">Calculating costs...</div>
    </div>
  {:else if !estimate}
    <div class="flex-1 flex items-center justify-center p-4">
      <p class="text-gray-500 text-center">
        No cost estimate available.<br/>
        Generate a floor plan to see costs.
      </p>
    </div>
  {:else}
    <!-- Scrollable content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Category breakdown -->
      <div class="divide-y divide-gray-100">
        {#each activeCategories as category}
          {@const subtotal = estimate.subtotals[category] ?? 0}
          {@const items = getCategoryItems(category)}
          {@const isExpanded = expandedCategories.has(category)}

          <div class="category-section">
            <button
              class="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              onclick={() => toggleCategory(category)}
            >
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-400">
                  {isExpanded ? '▼' : '▶'}
                </span>
                <span class="font-medium text-gray-900">
                  {CATEGORY_LABELS[category]}
                </span>
                <span class="text-xs text-gray-500">
                  ({items.length})
                </span>
              </div>
              <span class="font-mono text-gray-900">
                {formatCurrency(subtotal)}
              </span>
            </button>

            {#if isExpanded}
              <div class="px-4 pb-3 space-y-1">
                {#each items as item}
                  <div class="flex justify-between text-sm py-1 pl-6">
                    <span class="text-gray-600 truncate flex-1">
                      {item.description}
                    </span>
                    <span class="font-mono text-gray-700 ml-2">
                      {formatCurrency(item.total)}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- Summary footer -->
    <footer class="border-t border-gray-200 p-4 space-y-2 bg-gray-50">
      <div class="flex justify-between text-sm">
        <span class="text-gray-600">Materials</span>
        <span class="font-mono">{formatCurrency(estimate.materialTotal)}</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-600">Labor</span>
        <span class="font-mono">{formatCurrency(estimate.laborTotal)}</span>
      </div>
      <div class="flex justify-between text-lg font-bold pt-2 border-t border-gray-300">
        <span>Total</span>
        <span class="font-mono">{formatCurrency(estimate.grandTotal)}</span>
      </div>
    </footer>
  {/if}
</div>
