<script lang="ts">
  import type { Change } from "#lib/diff.ts";
  let { changes, empty = "No changes yet." }: { changes: Change[]; empty?: string } = $props();
  const mark = { added: "+", removed: "−", changed: "~" } as const;
  const color = { added: "text-primary", removed: "text-destructive", changed: "text-foreground" } as const;
</script>

{#if changes.length}
  <ul class="space-y-1 text-sm">
    {#each changes as c}
      <li class="flex gap-2">
        <span class={["w-3 font-mono font-bold", color[c.type]]}>{mark[c.type]}</span>
        <span><b>{c.label}</b>{#if c.type === "changed" && c.from !== undefined}: <span class="text-muted-foreground line-through">{c.from}</span> → {c.to}{:else if c.type === "added" && c.to}: {c.to}{:else if c.type === "removed" && c.from}: <span class="text-muted-foreground line-through">{c.from}</span>{/if}</span>
      </li>
    {/each}
  </ul>
{:else}
  <p class="text-muted-foreground text-sm">{empty}</p>
{/if}
