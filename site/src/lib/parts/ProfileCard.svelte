<script lang="ts">
  import type { Envelope } from "#lib/api.ts";
  import { opLabel } from "#lib/api.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  let { p, showRig = true }: { p: Envelope; showRig?: boolean } = $props();
</script>

<a href={`/p/${p.id}`} class="bg-card hover:border-primary block rounded-lg border p-4 no-underline transition-colors">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="text-foreground truncate font-medium">{p.title}</div>
      <div class="text-muted-foreground mt-1 text-sm">
        {#if showRig}{p.rig_macro.replace("RIG_MODEL_", "")} · {/if}by {p.author.callsign ?? "anonymous"}{#if p.forked_from} · ⑂ forked{/if}
      </div>
    </div>
    <Badge>{opLabel(p.operation)}</Badge>
  </div>
  <div class="text-muted-foreground mt-3 flex gap-4 text-sm">
    <span title="Worked for me">✓ {p.stats.worked}</span>
    {#if p.stats.not_worked}<span title="Didn't work">✗ {p.stats.not_worked}</span>{/if}
    <span title="Stars">★ {p.stats.stars}</span>
    {#if p.stats.comments}<span title="Comments">💬 {p.stats.comments}</span>{/if}
    {#if p.status !== "published"}<Badge variant="outline">{p.status}</Badge>{/if}
  </div>
</a>
