<script lang="ts">
  import { api, opLabel, type Envelope, type RigSummary } from "#lib/api.ts";
  import ProfileCard from "#lib/parts/ProfileCard.svelte";
  import { Input } from "#lib/components/ui/input/index.ts";
  import { Label } from "#lib/components/ui/label/index.ts";
  import { NativeSelect } from "#lib/components/ui/native-select/index.ts";

  let ops = $state<string[]>([]);
  let operation = $state("");
  let sort = $state("best");
  let rigQ = $state("");
  let rigs = $state<RigSummary[]>([]);
  let profiles = $state<Envelope[]>([]);
  let total = $state(0);
  let error = $state("");

  api.operations().then((o) => (ops = o.operations));
  $effect(() => {
    api.profiles({ operation, sort, limit: 60 }).then((r) => { profiles = r.profiles; total = r.total; }).catch((e) => (error = e.message));
  });
  let t: ReturnType<typeof setTimeout>;
  $effect(() => {
    const q = rigQ;
    clearTimeout(t);
    if (q.trim().length < 2) { rigs = []; return; }
    t = setTimeout(() => api.rigs(q).then((r) => (rigs = r.rigs.slice(0, 12))), 200);
  });
</script>

<section class="mb-8">
  <h1 class="text-2xl font-semibold">Radio settings that worked for someone else</h1>
  <p class="text-muted-foreground mt-1 max-w-3xl">
    Profiles for each radio and operation, checked against what Hamlib can set. Apps like <a href="https://github.com/open-rms/rigctlweb" rel="noopener noreferrer" target="_blank">rigctlWeb</a> and hamstack can read your radio, show the differences and apply them. Nothing here ever keys your transmitter.
  </p>
</section>

<div class="grid gap-6 md:grid-cols-[280px_1fr]">
  <aside class="space-y-5">
    <div class="grid gap-1.5">
      <Label for="rig">Find your radio</Label>
      <Input id="rig" placeholder="IC-7300, FTDX-10, K3…" bind:value={rigQ} />
      {#if rigs.length}
        <ul class="bg-card divide-y rounded-md border text-sm">
          {#each rigs as r}
            <li><a class="flex justify-between px-3 py-2 no-underline" href={`/rigs/${r.macro}`}><span>{r.mfg} {r.name}</span><span class="text-muted-foreground">{r.profiles}</span></a></li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="grid gap-1.5">
      <Label for="op">Operation</Label>
      <NativeSelect id="op" class="w-full" bind:value={operation}>
        <option value="">All</option>
        {#each ops as o}<option value={o}>{opLabel(o)}</option>{/each}
      </NativeSelect>
    </div>
    <div class="grid gap-1.5">
      <Label for="sort">Sort</Label>
      <NativeSelect id="sort" class="w-full" bind:value={sort}>
        <option value="best">Most "worked for me"</option>
        <option value="stars">Most stars</option>
        <option value="recent">Recently updated</option>
      </NativeSelect>
    </div>
  </aside>
  <section>
    <div class="text-muted-foreground mb-3 text-sm">{total} profile{total === 1 ? "" : "s"}</div>
    {#if error}<p class="text-destructive">{error}</p>{/if}
    <div class="grid gap-3 sm:grid-cols-2">
      {#each profiles as p (p.id)}<ProfileCard {p} />{/each}
    </div>
    {#if !profiles.length && !error}<p class="text-muted-foreground">No profiles yet. <a href="/submit">Be the first.</a></p>{/if}
  </section>
</div>
