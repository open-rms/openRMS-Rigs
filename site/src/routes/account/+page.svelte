<script lang="ts">
  import { api, type Envelope } from "#lib/api.ts";
  import { accountUrl, me, setDevToken, signInUrl, signOut } from "#lib/auth.ts";
  import ProfileCard from "#lib/parts/ProfileCard.svelte";
  import * as Card from "#lib/components/ui/card/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Textarea } from "#lib/components/ui/textarea/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";

  let mine = $state<Envelope[]>([]);
  let queue = $state<Envelope[]>([]);
  let dev = $state("");
  $effect(() => {
    if (!$me) return;
    api.myProfiles().then((r) => (mine = r.profiles));
    if ($me.moderator) api.queue().then((r) => (queue = r.profiles));
  });
  type Key = Awaited<ReturnType<typeof api.keys>>["keys"][number];
  let keys = $state<Key[]>([]);
  let keyName = $state("");
  let newKey = $state<string | null>(null);
  $effect(() => { if ($me) api.keys().then((r) => (keys = r.keys)).catch(() => (keys = [])); });
  async function mint() {
    const k = await api.mintKey(keyName || "rig agent");
    newKey = k.key; keyName = "";
    keys = (await api.keys()).keys;
  }
  async function revoke(id: string) {
    await api.revokeKey(id);
    keys = (await api.keys()).keys;
  }
  async function useDev() {
    setDevToken(dev || null);
    me.set(await api.me().catch(() => null));
  }
  async function setStatus(id: string, status: string) {
    await api.setStatus(id, status);
    queue = (await api.queue()).profiles;
    mine = (await api.myProfiles()).profiles;
  }
</script>

<h1 class="mb-4 text-2xl font-semibold">Account</h1>
{#if $me}
  <div class="mb-6 flex flex-wrap items-center gap-3 text-sm">
    <span>Signed in as <b>{$me.callsign ?? $me.sub}</b>{$me.callsign_verified ? " (verified)" : " (callsign not verified: your profiles wait for review)"} · role {$me.role}.</span>
    <Button size="sm" variant="outline" href={accountUrl()}>Account settings</Button>
    <Button size="sm" variant="ghost" onclick={signOut}>Sign out</Button>
  </div>
  <p class="text-muted-foreground -mt-4 mb-6 text-xs">One openRMS account for every openRMS app. Signing out here signs you out of all of them.</p>
  <h2 class="mb-2 text-lg font-medium">Your profiles</h2>
  <div class="mb-8 grid gap-3 sm:grid-cols-2">{#each mine as p (p.id)}<ProfileCard {p} />{:else}<p class="text-muted-foreground">None yet. <a href="/submit">Submit one.</a></p>{/each}</div>
  <h2 id="keys" class="mb-2 text-lg font-medium">API keys</h2>
  <p class="text-muted-foreground mb-3 max-w-3xl text-sm">For apps and scripts that submit profiles as you, e.g. <code>RIGS_KEY=… pnpm import-profiles</code>. Keys can submit and edit profiles; they can't star, comment, report or moderate. Profiles submitted with a key go to the review queue.</p>
  {#if newKey}
    <div class="bg-primary-soft mb-3 max-w-3xl rounded-md border p-3 text-sm">
      Your new key, shown once. Store it somewhere safe (a file only you can read):
      <code class="mt-1 block break-all select-all">{newKey}</code>
      <Button size="sm" variant="ghost" class="mt-1" onclick={() => (newKey = null)}>I've saved it</Button>
    </div>
  {/if}
  <div class="mb-3 flex max-w-md gap-2"><Input placeholder="Name, e.g. shack PC" bind:value={keyName} /><Button size="sm" onclick={mint}>Create key</Button></div>
  {#each keys as k (k.id)}
    <div class="flex max-w-3xl items-center gap-3 border-b py-1.5 text-sm">
      <code>{k.prefix}…</code><span class="flex-1">{k.name}</span>
      <span class="text-muted-foreground text-xs">{k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleDateString()}` : "never used"}</span>
      <Button size="sm" variant="ghost" onclick={() => revoke(k.id)}>Revoke</Button>
    </div>
  {:else}<p class="text-muted-foreground mb-8 text-sm">No keys.</p>{/each}
  <div class="mb-8"></div>

  {#if $me.moderator}
    <h2 id="queue" class="mb-2 text-lg font-medium">Review queue</h2>
    {#each queue as p (p.id)}
      <div class="mb-3 flex items-center gap-3"><div class="flex-1"><ProfileCard {p} /></div>
        <Button size="sm" onclick={() => setStatus(p.id, "published")}>Publish</Button>
        <Button size="sm" variant="outline" onclick={() => setStatus(p.id, "hidden")}>Hide</Button></div>
    {:else}<p class="text-muted-foreground">Nothing waiting.</p>{/each}
  {/if}
{:else}
  <p class="mb-3">You're not signed in.</p>
  <Button href={signInUrl()}>Sign in with your openRMS account</Button>
{/if}

<details class="mt-12 max-w-2xl"><summary class="text-muted-foreground cursor-pointer text-xs">Developer: paste a test token</summary>
<Card.Root class="mt-3">
  <Card.Header><Card.Title>Development: paste a token</Card.Title><Card.Description>Normally you sign in through openRMS Accounts. For testing, paste an access token for this API's audience.</Card.Description></Card.Header>
  <Card.Content class="space-y-2">
    <Textarea class="font-mono text-xs" bind:value={dev} placeholder="eyJ…" />
    <div class="flex gap-2"><Button size="sm" onclick={useDev}>Use token</Button><Button size="sm" variant="outline" onclick={() => { dev = ""; useDev(); }}>Clear</Button></div>
  </Card.Content>
</Card.Root>
</details>
