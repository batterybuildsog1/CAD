<script lang="ts">
  /**
   * ChatPanel.svelte - AI Chat Interface for Gemini CAD
   * Svelte 5 implementation with visual feedback support
   */
  import { geminiCAD, type ChatMessage } from '$lib/gemini-cad.svelte';

  // Props
  interface Props {
    canvas?: HTMLCanvasElement | null;
    onGenerate?: () => void;
  }

  let { canvas = null, onGenerate }: Props = $props();

  // Local state
  let inputValue = $state('');
  let inputElement: HTMLTextAreaElement;

  // Derived state from geminiCAD singleton
  let messages = $derived(geminiCAD.messages);
  let loading = $derived(geminiCAD.loading);
  let error = $derived(geminiCAD.error);
  let totalTokens = $derived(geminiCAD.totalTokens);

  // Set canvas reference when provided
  $effect(() => {
    if (canvas) {
      geminiCAD.setCanvas(canvas);
    }
  });

  // Auto-scroll to bottom when messages change
  let messagesContainer: HTMLDivElement;
  $effect(() => {
    if (messages.length > 0 && messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  async function handleSubmit() {
    const prompt = inputValue.trim();
    if (!prompt || loading) return;

    inputValue = '';

    try {
      await geminiCAD.generate(prompt);
      onGenerate?.();
    } catch (e) {
      console.error('[ChatPanel] Generation error:', e);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  function formatTimestamp(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function clearChat() {
    geminiCAD.clearMessages();
  }
</script>

<div class="flex flex-col h-full bg-white border-l border-gray-200">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-gray-900">Gemini CAD Assistant</h2>
      {#if totalTokens > 0}
        <span class="text-xs text-gray-500">({totalTokens.toLocaleString()} tokens)</span>
      {/if}
    </div>
    <button
      onclick={clearChat}
      class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
    >
      Clear
    </button>
  </div>

  <!-- Messages -->
  <div
    bind:this={messagesContainer}
    class="flex-1 overflow-y-auto p-4 space-y-4"
  >
    {#if messages.length === 0}
      <div class="text-center text-gray-500 py-8">
        <p class="text-sm">Start designing by describing what you want to build.</p>
        <p class="text-xs mt-2 text-gray-400">
          Example: "Create a 1200 sqft house with 2 bedrooms and 1 bathroom"
        </p>
      </div>
    {:else}
      {#each messages as message}
        <div
          class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}"
        >
          <div
            class="max-w-[85%] rounded-lg px-4 py-2 {message.role === 'user'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900'}"
          >
            {#if message.thinking}
              <details class="mb-2">
                <summary class="text-xs opacity-70 cursor-pointer">
                  Thinking...
                </summary>
                <p class="text-xs opacity-60 mt-1 whitespace-pre-wrap">
                  {message.thinking}
                </p>
              </details>
            {/if}

            <p class="text-sm whitespace-pre-wrap">{message.content}</p>

            <p class="text-xs opacity-60 mt-1">
              {formatTimestamp(message.timestamp)}
            </p>
          </div>
        </div>
      {/each}
    {/if}

    {#if loading}
      <div class="flex justify-start">
        <div class="bg-gray-100 rounded-lg px-4 py-2">
          <div class="flex items-center gap-2">
            <div class="animate-pulse flex gap-1">
              <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms"></div>
              <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
              <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms"></div>
            </div>
            <span class="text-sm text-gray-500">Generating...</span>
          </div>
        </div>
      </div>
    {/if}

    {#if error}
      <div class="bg-red-50 border border-red-200 rounded-lg px-4 py-2">
        <p class="text-sm text-red-600">{error}</p>
      </div>
    {/if}
  </div>

  <!-- Input -->
  <div class="border-t border-gray-200 p-4">
    <div class="flex gap-2">
      <textarea
        bind:this={inputElement}
        bind:value={inputValue}
        onkeydown={handleKeyDown}
        placeholder="Describe what you want to build..."
        rows="2"
        disabled={loading}
        class="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm
               focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
               disabled:bg-gray-100 disabled:cursor-not-allowed"
      ></textarea>
      <button
        onclick={handleSubmit}
        disabled={loading || !inputValue.trim()}
        class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium
               hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
               disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Generating...' : 'Send'}
      </button>
    </div>
  </div>
</div>
