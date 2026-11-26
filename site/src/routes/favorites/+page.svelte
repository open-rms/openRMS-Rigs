<script lang="ts">
  import { api, opLabel, type Envelope } from "#lib/api.ts";
  import { me, signInUrl } from "#lib/auth.ts";
  import ProfileCard from "#lib/parts/ProfileCard.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { NativeSelect } from "#lib/components/ui/native-select/index.ts";

  type Fav = Envelope & { saved_at: string };
  let favs = $state<Fav[]>([]);
  let loaded = $state(false);
  let operation = $state("");
  $effect(() => {
    if (!$me) return;
    api.favorites().then((r) => { favs = r.favorites; loaded = true; });
  });
  const ops = $derived([...new Set(favs.map((f) => f.operation))].sort());
  // Grouped by radio, so "my FT8 settings for the shack rig" are together.
  const byRig = $derived(Object.entries(Object.groupBy(favs.filter((f) => !operation || f.operation === operation), (f) => f.rig_macro)) as [string, Fav[]][]);
  async function unsave(id: string) {
    await api.favorite(id, false);
    favs = favs.filter((f) => f.id !== id);
  }
</script>

<div class="mb-5 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="text-2xl font-semibold">Favorites</h1>
    <p class="text-muted-foreground text-sm">Private: only you see these. Apps signed in as you (rigctlWeb, hamstack) can list them to find your settings fast.</p>
  </div>
  {#if ops.length > 1}
    <NativeSelect class="w-48" bind:value={operation}>
      <option value="">All operations</option>
      {#each ops as o}<option value={o}>{opLabel(o)}</option>{/each}
    </NativeSelect>
  {/if}
</div>

{#if !$me}
  <p class="mb-3">Sign in to save profiles to your favorites.</p>
  <Button href={signInUrl()}>Sign in</Button>
{:else if loaded && !favs.length}
  <p class="text-muted-foreground">Nothing saved yet. Open a profile and choose <b>♡ Save to favorites</b>.</p>
{:else}
  <div class="space-y-6">
    {#each byRig as [macro, list]}
      <section>
        <h2 class="mb-2 text-lg font-medium"><a href={`/rigs/${macro}`}>{macro.replace("RIG_MODEL_", "")}</a></h2>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each list as f (f.id)}
            <div class="relative">
              <ProfileCard p={f} showRig={false} />
              <button class="text-muted-foreground hover:text-destructive absolute right-3 bottom-3 text-xs" onclick={() => unsave(f.id)}>Remove</button>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}
