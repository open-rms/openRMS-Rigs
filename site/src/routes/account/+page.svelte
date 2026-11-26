<script lang="ts">
  import { api, type AccountKey, type Envelope } from "#lib/api.ts";
  import { accountUrl, me, setDevToken, signInUrl, signOut } from "#lib/auth.ts";
  import ProfileCard from "#lib/parts/ProfileCard.svelte";
  import * as Card from "#lib/components/ui/card/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Textarea } from "#lib/components/ui/textarea/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";

  let mine = $state<Envelope[]>([]);
  // "Your profiles" grouped by radio, collapsed until the radio's card is clicked.
  let open = $state<Record<string, boolean>>({});
  let rigNames = $state<Record<string, string>>({});
  const groups = $derived.by(() => {
    const m = new Map<string, Envelope[]>();
    for (const p of mine) m.set(p.rig_macro, [...(m.get(p.rig_macro) ?? []), p]);
    return [...m].map(([macro, profiles]) => ({ macro, profiles })).sort((a, b) => (rigNames[a.macro] ?? a.macro).localeCompare(rigNames[b.macro] ?? b.macro));
  });
  $effect(() => {
    for (const g of groups) {
      if (rigNames[g.macro] === undefined) {
        rigNames[g.macro] = g.macro.replace(/^RIG_MODEL_/, "");
        api.rig(g.macro).then((r) => (rigNames[g.macro] = `${r.mfg} ${r.name}`)).catch(() => {});
      }
    }
  });
  const pendingIn = (ps: Envelope[]) => ps.filter((p) => p.status !== "published" || p.current_revision !== p.published_revision).length;
  let queue = $state<Envelope[]>([]);
  let dev = $state("");
  $effect(() => {
    if (!$me) return;
    api.myProfiles().then((r) => (mine = r.profiles));
    if ($me.moderator) api.queue().then((r) => (queue = r.profiles));
  });
  let keys = $state<AccountKey[]>([]);
  let keysAvailable = $state(true);
  let manageUrl = $state(accountUrl().replace(/\/account.*$/, "") + "/keys");
  $effect(() => {
    if (!$me) return;
    api.keys().then((r) => { keys = r.keys.filter((k) => !k.revoked_at); keysAvailable = r.available; manageUrl = r.manage_url; }).catch(() => (keysAvailable = false));
  });
  const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "");
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
  <div class="mb-8 space-y-3">
    {#each groups as g (g.macro)}
      {@const pending = pendingIn(g.profiles)}
      <Card.Root>
        <button type="button" class="flex w-full items-center gap-3 px-6 py-4 text-left" aria-expanded={!!open[g.macro]} onclick={() => (open[g.macro] = !open[g.macro])}>
          <span class="text-muted-foreground w-4 text-xs">{open[g.macro] ? "▾" : "▸"}</span>
          <span class="flex-1 font-medium">{rigNames[g.macro] ?? g.macro}</span>
          <span class="text-muted-foreground text-sm">{g.profiles.length} profile{g.profiles.length === 1 ? "" : "s"}{pending ? ` · ${pending} awaiting review` : ""}</span>
        </button>
        {#if open[g.macro]}
          <Card.Content class="grid gap-3 sm:grid-cols-2">{#each g.profiles as p (p.id)}<ProfileCard {p} />{/each}</Card.Content>
        {/if}
      </Card.Root>
    {:else}<p class="text-muted-foreground">None yet. <a href="/submit">Submit one.</a></p>{/each}
  </div>
  <h2 id="keys" class="mb-2 text-lg font-medium">API keys</h2>
  <p class="text-muted-foreground mb-3 max-w-3xl text-sm">
    Keys for apps and scripts (rigctlWeb, hamstack, <code>RIGS_KEY=… pnpm import-profiles</code>) are made at openRMS Accounts. Pick Rigs and tick what the key may do: submit and edit profiles, read your pending ones, favorites, "worked" reports, comments. Keys can never star or moderate. Profiles submitted with a key go to the review queue.
  </p>
  <Button class="mb-3" variant="outline" href={manageUrl} target="_blank" rel="noopener">Make or revoke keys at Accounts ↗</Button>
  {#each keys as k (k.jti)}
    <div class="flex max-w-3xl flex-wrap items-center gap-3 border-b py-1.5 text-sm">
      <span class="flex-1 font-medium">{k.name ?? k.jti.slice(0, 8)}</span>
      {#if k.scopes?.length}<span class="text-muted-foreground font-mono text-xs">{k.scopes.join(" ")}</span>{/if}
      <span class="text-muted-foreground text-xs">{k.last_used_at ? `used ${day(k.last_used_at)}` : "never used"}{k.expires_at ? ` · expires ${day(k.expires_at)}` : ""}</span>
    </div>
  {:else}<p class="text-muted-foreground text-sm">{keysAvailable ? "No Rigs keys yet." : "Your keys are listed at Accounts."}</p>{/each}
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
  <p class="mb-3">You're not signed in. Sign in to see your profiles and API keys.</p>
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
