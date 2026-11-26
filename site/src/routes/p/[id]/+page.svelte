<script lang="ts">
  import { page } from "$app/state";
  import { api, opLabel, type Envelope, type PlanStep } from "#lib/api.ts";
  import { me, signInUrl } from "#lib/auth.ts";
  import * as Card from "#lib/components/ui/card/index.ts";
  import * as Table from "#lib/components/ui/table/index.ts";
  import * as Tabs from "#lib/components/ui/tabs/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import { Checkbox } from "#lib/components/ui/checkbox/index.ts";
  import ChangeList from "#lib/parts/ChangeList.svelte";
  import Comments from "#lib/parts/Comments.svelte";
  import ProfileCard from "#lib/parts/ProfileCard.svelte";
  import { diffDocs, type Change } from "#lib/diff.ts";
  import { fromText } from "#lib/profile-doc.ts";

  let p = $state<Envelope | null>(null);
  let plan = $state<PlanStep[]>([]);
  let yaml = $state("");
  let reports = $state<Awaited<ReturnType<typeof api.reports>>["reports"]>([]);
  let error = $state("");
  let msg = $state("");
  let firmware = $state("");
  let done = $state<Record<string, boolean>>({});
  let forks = $state<Envelope[]>([]);
  let parentChanges = $state<Change[] | null>(null);

  const id = $derived(page.params.id!);
  $effect(() => {
    api.profile(id).then((r) => (p = r)).catch((e) => (error = e.message));
    api.plan(id).then((r) => (plan = r.steps)).catch(() => {});
    api.yaml(id).then((y) => (yaml = y)).catch(() => {});
    api.reports(id).then((r) => (reports = r.reports));
    api.forks(id).then((r) => (forks = r.forks)).catch(() => (forks = []));
  });
  // "Forked from": diff against the exact parent revision it was cloned from.
  $effect(() => {
    const f = p?.forked_from, d = p?.document;
    parentChanges = null;
    if (f?.available && f.revision && d) {
      api.yamlAt(f.id, f.revision).then((y) => (parentChanges = diffDocs(fromText(y), d))).catch(() => (parentChanges = null));
    }
  });
  const doc = $derived(p?.document);
  const auto = $derived(plan.filter((s) => s.kind !== "manual"));
  const manual = $derived(doc?.steps.filter((s) => s.kind === "manual") ?? []);
  const show = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : String(v ?? ""));

  const blankViewer = { favorite: false, starred: false, starred_at: null, report: null, owner: false };
  async function toggleFavorite() {
    if (!p) return;
    const on = !p.viewer?.favorite;
    await api.favorite(p.id, on);
    p.viewer = { ...(p.viewer ?? blankViewer), favorite: on };
  }
  async function toggleStar() {
    if (!p) return;
    const on = !p.viewer?.starred;
    const r = await api.star(p.id, on);
    p.stats.stars = r.stars;
    p.viewer = { ...(p.viewer ?? blankViewer), starred: on };
  }
  let commentCount = $state<number | null>(null);
  async function report(worked: boolean) {
    if (!p) return;
    await api.report(p.id, { worked, firmware: firmware || undefined });
    msg = "Thanks, recorded.";
    p = await api.profile(id);
    reports = (await api.reports(id)).reports;
  }
</script>

{#if error}<p class="text-destructive">{error}</p>{/if}
{#if p && doc}
  <div class="mb-6">
    <div class="text-muted-foreground text-sm"><a href={`/rigs/${doc.rig.macro}`}>{doc.rig.mfg} {doc.rig.name}</a> · {opLabel(doc.operation)} · {doc.connection}{doc.interface ? ` · ${doc.interface}` : ""}</div>
    <h1 class="mt-1 text-2xl font-semibold">{doc.title}</h1>
    {#if doc.summary}<p class="text-muted-foreground mt-1 max-w-3xl">{doc.summary}</p>{/if}
    {#if p.forked_from}
      <p class="mt-2 text-sm">
        ⑂ Forked from
        {#if p.forked_from.available}<a href={`/p/${p.forked_from.id}`}>{p.forked_from.title}</a> (revision {p.forked_from.revision}) by {p.forked_from.author?.callsign ?? "anonymous"}{:else}a profile that is no longer public{/if}
      </p>
    {/if}
    <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span>by <b>{p.author.callsign ?? "anonymous"}</b></span>
      <span>✓ {p.stats.worked} worked</span>{#if p.stats.not_worked}<span>✗ {p.stats.not_worked} didn't</span>{/if}
      <span>★ {p.stats.stars}</span>
      {#if p.stats.forks}<span>⑂ {p.stats.forks} fork{p.stats.forks === 1 ? "" : "s"}</span>{/if}
      <span class="text-muted-foreground">revision {p.revision} · Hamlib {doc.hamlib}{doc.rig.firmware ? ` · firmware ${doc.rig.firmware}` : ""}</span>
      {#if p.status !== "published"}<Badge variant="outline">{p.status}</Badge>{/if}
    </div>
  </div>

  <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
    <div class="space-y-6">
      <Tabs.Root value="steps" class="flex-col">
        <Tabs.List>
          <Tabs.Trigger value="steps">Settings</Tabs.Trigger>
          <Tabs.Trigger value="yaml">YAML</Tabs.Trigger>
          <Tabs.Trigger value="comments">Comments ({commentCount ?? p.stats.comments ?? 0})</Tabs.Trigger>
          <Tabs.Trigger value="reports">Reports ({reports.length})</Tabs.Trigger>
          {#if p.forked_from?.available}<Tabs.Trigger value="diff">Changes from original{parentChanges ? ` (${parentChanges.length})` : ""}</Tabs.Trigger>{/if}
          {#if forks.length}<Tabs.Trigger value="forks">Forks ({forks.length})</Tabs.Trigger>{/if}
        </Tabs.List>
        <Tabs.Content value="steps" class="space-y-6 pt-4">
          {#if auto.length}
            <Card.Root>
              <Card.Header><Card.Title>Set over CAT</Card.Title><Card.Description>An app can check and apply these through rigctld. Steps marked TX change transmit behaviour; the app asks first.</Card.Description></Card.Header>
              <Card.Content>
                <Table.Root>
                  <Table.Header><Table.Row><Table.Head>Setting</Table.Head><Table.Head>Value</Table.Head><Table.Head></Table.Head><Table.Head class="hidden md:table-cell">rigctld</Table.Head></Table.Row></Table.Header>
                  <Table.Body>
                    {#each auto as s}
                      {@const src = doc.steps.find((d) => d.id === s.id)}
                      <Table.Row>
                        <Table.Cell><div class="font-medium">{s.name}</div>{#if src?.note}<div class="text-muted-foreground max-w-md text-xs">{src.note}</div>{/if}</Table.Cell>
                        <Table.Cell>{s.check_only ? "check" : src?.display ?? show(src?.value)}{#if src?.passband_hz}, {src.passband_hz} Hz{/if}</Table.Cell>
                        <Table.Cell class="space-x-1 whitespace-nowrap">
                          {#if s.safety === "tx"}<Badge variant="destructive">TX</Badge>{/if}
                          {#if s.kind === "cat"}<Badge variant="outline">raw CAT</Badge>{/if}
                          {#if !s.readable}<Badge variant="outline" title="Can't be read back or restored automatically">no readback</Badge>{/if}
                        </Table.Cell>
                        <Table.Cell class="hidden font-mono text-xs md:table-cell">{s.rigctld.set ?? s.rigctld.get ?? "—"}</Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              </Card.Content>
            </Card.Root>
          {/if}
          {#if manual.length}
            <Card.Root>
              <Card.Header><Card.Title>On the radio</Card.Title><Card.Description>Menu settings CAT can't reach. Tick them off as you go.</Card.Description></Card.Header>
              <Card.Content class="space-y-3">
                {#each manual as s}
                  <label class="flex items-start gap-3">
                    <Checkbox checked={!!done[s.id]} onCheckedChange={(v) => (done[s.id] = v)} />
                    <span><span class="font-mono text-sm">{s.manual?.menu}</span> → <b>{s.manual?.value}</b>{#if s.safety === "tx"} <Badge variant="destructive">TX</Badge>{/if}
                      {#if s.note}<span class="text-muted-foreground block text-xs">{s.note}</span>{/if}</span>
                  </label>
                {/each}
              </Card.Content>
            </Card.Root>
          {/if}
          {#if doc.software?.length}
            <Card.Root>
              <Card.Header><Card.Title>Software</Card.Title></Card.Header>
              <Card.Content>
                <Table.Root><Table.Body>
                  {#each doc.software as s}<Table.Row><Table.Cell class="text-muted-foreground">{s.app}</Table.Cell><Table.Cell>{s.setting}</Table.Cell><Table.Cell class="font-medium">{s.value}</Table.Cell></Table.Row>{/each}
                </Table.Body></Table.Root>
              </Card.Content>
            </Card.Root>
          {/if}
          {#if doc.audio || doc.notes}
            <Card.Root>
              <Card.Header><Card.Title>Levels and notes</Card.Title></Card.Header>
              <Card.Content class="space-y-2 text-sm">
                {#if doc.audio?.rx_target_dbfs !== undefined}<p>Receive audio target: <b>{doc.audio.rx_target_dbfs} dBFS</b> noise floor.</p>{/if}
                {#if doc.audio?.rx_note}<p>{doc.audio.rx_note}</p>{/if}
                {#if doc.audio?.tx_note}<p>{doc.audio.tx_note}</p>{/if}
                {#if doc.notes}<p class="whitespace-pre-line">{doc.notes}</p>{/if}
              </Card.Content>
            </Card.Root>
          {/if}
        </Tabs.Content>
        <Tabs.Content value="yaml" class="pt-4">
          <pre class="bg-card overflow-auto rounded-lg border p-4 text-xs">{yaml}</pre>
        </Tabs.Content>
        <Tabs.Content value="comments" class="pt-4">
          <Comments profileId={p.id} onCount={(n) => (commentCount = n)} />
        </Tabs.Content>
        <Tabs.Content value="diff" class="pt-4">
          {#if parentChanges}<ChangeList changes={parentChanges} empty="Same settings as the original." />{:else}<p class="text-muted-foreground text-sm">Loading…</p>{/if}
        </Tabs.Content>
        <Tabs.Content value="forks" class="grid gap-3 pt-4 sm:grid-cols-2">
          {#each forks as f (f.id)}<ProfileCard p={f} />{/each}
        </Tabs.Content>
        <Tabs.Content value="reports" class="pt-4">
          {#each reports as r}
            <div class="border-b py-2 text-sm">
              <b>{r.worked ? "✓ Worked" : "✗ Didn't work"}</b> · {r.callsign ?? "anonymous"} · rev {r.revision}
              {#if r.firmware} · fw {r.firmware}{/if}{#if r.hamlib} · Hamlib {r.hamlib}{/if}
              {#if r.note}<div class="text-muted-foreground">{r.note}</div>{/if}
            </div>
          {:else}<p class="text-muted-foreground">No reports yet.</p>{/each}
        </Tabs.Content>
      </Tabs.Root>
    </div>

    <aside class="space-y-4">
      <Card.Root>
        <Card.Header><Card.Title>Get it</Card.Title></Card.Header>
        <Card.Content class="grid gap-2">
          <Button variant="outline" href={p.links.yaml} download={`${p.id}.yaml`}>Download YAML</Button>
          <Button variant="outline" href={p.links.json} download={`${p.id}.json`}>Download JSON</Button>
          <Button href={`/submit?fork=${p.id}&revision=${p.revision}`}>⑂ Clone and change</Button>
          <p class="text-muted-foreground text-xs">Start from these settings and change only what's different for your station. Your profile links back here.</p>
          <p class="text-muted-foreground text-xs">Apps: <code class="break-all">GET {p.links.apply_plan}</code></p>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header><Card.Title>Did it work for you?</Card.Title></Card.Header>
        <Card.Content class="grid gap-2">
          {#if $me}
            <Input placeholder="Your firmware (optional)" bind:value={firmware} />
            <div class="flex gap-2"><Button onclick={() => report(true)}>✓ Worked</Button><Button variant="outline" onclick={() => report(false)}>✗ Didn't</Button></div>
            <Button variant={p.viewer?.favorite ? "secondary" : "outline"} onclick={toggleFavorite}>{p.viewer?.favorite ? "♥ Saved to your favorites" : "♡ Save to favorites"}</Button>
            <p class="text-muted-foreground -mt-1 text-xs">Favorites are private: only you see them.</p>
            <Button variant="ghost" size="sm" onclick={toggleStar} title="Public: tells others you recommend it">{p.viewer?.starred ? "★ Starred" : "☆ Star"} · {p.stats.stars}</Button>
            {#if p.viewer?.report}<p class="text-muted-foreground text-xs">You reported: {p.viewer.report.worked ? "worked" : "didn't work"} (revision {p.viewer.report.revision}).</p>{/if}
            {#if $me.sub && p.status !== "hidden"}<Button variant="link" href={`/submit?edit=${p.id}`}>Edit (new revision)</Button>{/if}
            {#if msg}<p class="text-sm">{msg}</p>{/if}
          {:else}
            <Button variant="outline" href={signInUrl()}>Sign in to report or save to favorites</Button>
          {/if}
        </Card.Content>
      </Card.Root>
    </aside>
  </div>
{/if}
