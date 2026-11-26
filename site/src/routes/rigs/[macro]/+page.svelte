<script lang="ts">
  import { page } from "$app/state";
  import { api, opLabel, type Envelope, type Rig } from "#lib/api.ts";
  import ProfileCard from "#lib/parts/ProfileCard.svelte";
  import * as Card from "#lib/components/ui/card/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";

  let rig = $state<Rig | null>(null);
  let profiles = $state<Envelope[]>([]);
  let error = $state("");
  $effect(() => {
    const m = page.params.macro!;
    api.rig(m).then((r) => (rig = r)).catch((e) => (error = e.message));
    api.profiles({ rig: m, limit: 200 }).then((r) => (profiles = r.profiles));
  });
  const byOp = $derived(Object.entries(Object.groupBy(profiles, (p) => p.operation)) as [string, Envelope[]][]);
  const fmt = (c: { range: { min: number; max: number; step: number } | null; choices?: string[] }) =>
    c.choices ? c.choices.join(", ") : c.range ? `${c.range.min} … ${c.range.max}` : "—";
</script>

{#if error}<p class="text-destructive">{error}</p>{/if}
{#if rig}
  <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold">{rig.mfg} {rig.name}</h1>
      <p class="text-muted-foreground text-sm">Hamlib {rig.hamlib} · model {rig.hamlib_model} · <code>{rig.macro}</code> · backend {rig.status}</p>
    </div>
    <Button href={`/submit?rig=${rig.macro}`}>Add a profile for this radio</Button>
  </div>

  <div class="grid gap-6 lg:grid-cols-[1fr_380px]">
    <section class="space-y-6">
      {#each byOp as [op, list]}
        <div>
          <h2 class="mb-2 text-lg font-medium">{opLabel(op)}</h2>
          <div class="grid gap-3 sm:grid-cols-2">{#each list as p (p.id)}<ProfileCard {p} showRig={false} />{/each}</div>
        </div>
      {/each}
      {#if !profiles.length}<p class="text-muted-foreground">No profiles for this radio yet.</p>{/if}
    </section>

    <Card.Root>
      <Card.Header><Card.Title>What Hamlib can set</Card.Title><Card.Description>From <code>rigctl --dump-caps</code>. Settings outside this list go in profiles as raw CAT or manual steps.</Card.Description></Card.Header>
      <Card.Content class="space-y-4 text-sm">
        <div><div class="mb-1 font-medium">Modes</div><div class="flex flex-wrap gap-1">{#each rig.caps.modes as m}<Badge variant="outline">{m}</Badge>{/each}</div></div>
        <div><div class="mb-1 font-medium">Functions</div><div class="flex flex-wrap gap-1">{#each rig.caps.funcs.set as f}<Badge variant="secondary">{f}</Badge>{/each}</div></div>
        <div>
          <div class="mb-1 font-medium">Levels</div>
          <Table.Root>
            <Table.Header><Table.Row><Table.Head>Name</Table.Head><Table.Head>Range</Table.Head><Table.Head>Unit</Table.Head></Table.Row></Table.Header>
            <Table.Body>
              {#each Object.entries(rig.caps.levels.set) as [name, c]}
                <Table.Row><Table.Cell class="font-mono text-xs">{name}</Table.Cell><Table.Cell class="text-xs">{fmt(c)}</Table.Cell><Table.Cell class="text-muted-foreground text-xs">{c.unit}</Table.Cell></Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      </Card.Content>
    </Card.Root>
  </div>
{/if}
