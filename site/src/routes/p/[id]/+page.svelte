<script lang="ts">
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { api, opLabel, type Envelope, type PlanStep, type Step } from "#lib/api.ts";
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

  // Manual-first: the checklist view is the default; "Show CAT / rigctld" reveals the technical
  // view. Remembered in localStorage; ?view=cat (or ?view=manual) in the URL wins, for sharing.
  const VIEW_KEY = "rigs.view";
  let catView = $state(false);
  $effect(() => {
    const q = page.url.searchParams.get("view");
    catView = q ? q === "cat" : localStorage.getItem(VIEW_KEY) === "cat";
  });
  function setCatView(on: boolean) {
    catView = on;
    localStorage.setItem(VIEW_KEY, on ? "cat" : "manual");
    const u = new URL(page.url.href);
    if (on) u.searchParams.set("view", "cat"); else u.searchParams.delete("view");
    replaceState(u, {});
  }

  /** One checklist row per step, in document order. */
  type Row = { id: string; name: string; menu: string[] | null; value: string; tx: boolean; note?: string; sources?: string[]; confidence?: string; needsMenu: boolean; check: boolean };
  const planById = $derived(new Map(plan.map((s) => [s.id, s])));
  const NO_UNIT = new Set(["fraction", "enum", "bool", ""]);
  function valueText(s: Step, ps: PlanStep | undefined): string {
    if (s.kind === "manual") return s.manual?.value ?? "";
    if (s.check_only) return `check${expectText(s.expect) ? `: ${expectText(s.expect)}` : ""}`;
    if (s.display) return s.display;
    const raw = s.cat?.values?.[String(s.value)] ? `${s.cat.values[String(s.value)]} (${s.value})` : show(s.value);
    const unit = s.unit ?? ps?.unit ?? "";
    return `${raw}${unit && !NO_UNIT.has(unit) ? ` ${unit}` : ""}${s.passband_hz ? `, ${s.passband_hz} Hz passband` : ""}`;
  }
  const rows = $derived<Row[]>((doc?.steps ?? []).map((s) => {
    const ps = planById.get(s.id);
    const menu = s.menu ?? ps?.menu ?? (s.manual?.menu ? s.manual.menu.split(">").map((x) => x.trim()).filter(Boolean) : null);
    return {
      id: s.id, name: s.kind === "mode" ? "Mode" : s.name, menu: menu?.length ? menu : null, value: valueText(s, ps),
      tx: (ps?.safety ?? s.safety) === "tx", note: s.note, sources: s.sources, confidence: s.confidence,
      needsMenu: !menu?.length && s.kind !== "mode", check: !!s.check_only,
    };
  }));
  const missingMenus = $derived(rows.filter((r) => r.needsMenu).length);
  const show = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : String(v ?? ""));
  const expectText = (e: Step["expect"]) => !e ? "" : [e.one_of?.join(" or "), e.min !== undefined && `≥ ${e.min}`, e.max !== undefined && `≤ ${e.max}`, e.not?.length && `not ${e.not.join("/")}`].filter(Boolean).join(", ");

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

{#snippet refs(ids: string[] | undefined, confidence: string | undefined)}
  {#if ids?.length}<span class="ml-1 text-xs">{#each ids as id}<a href={`#src-${id}`} class="font-mono no-underline">[{id}]</a>{/each}</span>{/if}
  {#if confidence}<span class={["ml-1 rounded px-1 text-[10px] uppercase", confidence === "high" ? "bg-primary-soft text-primary" : confidence === "low" ? "bg-muted text-muted-foreground" : "bg-secondary"]} title="How well the sources support this value">{confidence}</span>{/if}
{/snippet}

<svelte:head><title>{doc ? `${doc.title} · openRMS Rigs` : error ? "Profile not found · openRMS Rigs" : "openRMS Rigs"}</title></svelte:head>

{#if error}<p class="text-destructive">{error}</p>{/if}
{#if p && doc}
  <!-- Printed instead of the page: a plain checklist with credit. -->
  <section class="hidden text-black print:block">
    <h1 class="text-xl font-semibold">{doc.title}</h1>
    <p class="text-sm">{doc.rig.mfg} {doc.rig.name} · {opLabel(doc.operation)} · {doc.connection}{doc.interface ? ` · ${doc.interface}` : ""}</p>
    <table class="mt-4 w-full border-collapse text-sm">
      <thead><tr class="border-b text-left"><th class="w-6 py-1"></th><th class="py-1">Where</th><th class="py-1">Setting</th><th class="py-1">Value</th></tr></thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr class="break-inside-avoid border-b align-top">
            <td class="py-1.5"><span class="inline-block h-3.5 w-3.5 border border-black"></span></td>
            <td class="py-1.5 pr-2 font-mono text-xs">{r.menu ? r.menu.join(" > ") : "—"}</td>
            <td class="py-1.5 pr-2">{r.name}{r.tx ? " (TX)" : ""}{#if r.sources?.length} <span class="text-xs">[{r.sources.join(", ")}]</span>{/if}</td>
            <td class="py-1.5 font-semibold">{r.value}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if doc.audio?.rx_note || doc.audio?.tx_note}<p class="mt-3 text-xs">{doc.audio?.rx_note} {doc.audio?.tx_note}</p>{/if}
    <footer class="mt-6 border-t pt-2 text-xs">
      "{doc.title}", revision {p.revision}, by {p.author.callsign ?? "anonymous"}. https://rigs.openrms.dev/p/{p.id} · CC-BY-SA-4.0.
      {#if doc.sources?.length}Sources: {#each doc.sources as so, i}{i ? "; " : ""}[{so.id}] {so.title}{so.author ? ` (${so.author})` : ""}{/each}.{/if}
    </footer>
  </section>

  <div class="print:hidden">
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
          <div class="flex flex-wrap items-center gap-3">
            <label class="flex items-center gap-2 text-sm"><Checkbox checked={catView} onCheckedChange={(v) => setCatView(!!v)} /> Show CAT / rigctld</label>
            <Button variant="outline" size="sm" onclick={() => window.print()}>Print checklist</Button>
            {#if missingMenus}<span class="text-muted-foreground text-xs">{missingMenus} step{missingMenus === 1 ? "" : "s"} without a menu path</span>{/if}
          </div>
          {#if !catView}
            <Card.Root>
              <Card.Header><Card.Title>Setup checklist</Card.Title><Card.Description>Set each item on the radio and tick it off. TX items change transmit behaviour.</Card.Description></Card.Header>
              <Card.Content>
                <ol class="divide-y">
                  {#each rows as r (r.id)}
                    <li class="py-2.5">
                      <label class="flex items-start gap-3">
                        <Checkbox class="mt-0.5" checked={!!done[r.id]} onCheckedChange={(v) => (done[r.id] = v)} />
                        <span class="min-w-0 flex-1">
                          {#if r.menu}<span class="text-muted-foreground block font-mono text-xs">{r.menu.join(" > ")}</span>{/if}
                          <span class="font-medium">{r.name}</span> → <b>{r.value}</b>{#if r.tx} <Badge variant="destructive">TX</Badge>{/if}{@render refs(r.sources, r.confidence)}
                          {#if r.note}<span class="text-muted-foreground block text-xs">{r.note}</span>{/if}
                          {#if r.needsMenu}<span class="text-muted-foreground block text-[11px] italic">Menu path missing. <a href={`/submit?fork=${p.id}&revision=${p.revision}`}>Help fill it in</a> or say where it is in the comments.</span>{/if}
                        </span>
                      </label>
                    </li>
                  {/each}
                </ol>
              </Card.Content>
            </Card.Root>
          {:else}
          {#if auto.length}
            <Card.Root>
              <Card.Header><Card.Title>Set over CAT</Card.Title><Card.Description>An app can check and apply these through rigctld. Steps marked TX change transmit behaviour; the app asks first.</Card.Description></Card.Header>
              <Card.Content>
                <Table.Root>
                  <Table.Header><Table.Row><Table.Head>Setting</Table.Head><Table.Head>Value</Table.Head><Table.Head>Kind</Table.Head><Table.Head></Table.Head><Table.Head>rigctld get / set</Table.Head></Table.Row></Table.Header>
                  <Table.Body>
                    {#each auto as s}
                      {@const src = doc.steps.find((d) => d.id === s.id)}
                      <Table.Row>
                        <Table.Cell><div class="font-medium">{s.name}{@render refs(src?.sources, src?.confidence)}</div>{#if src?.menu?.length}<div class="text-muted-foreground max-w-md font-mono text-xs" title="Where to find it on the radio">{src.menu.join(" > ")}</div>{/if}{#if src?.note}<div class="text-muted-foreground max-w-md text-xs">{src.note}</div>{/if}</Table.Cell>
                        <Table.Cell>{src ? valueText(src, s) : ""}{#if s.tolerance}<div class="text-muted-foreground text-[11px]">± {s.tolerance}</div>{/if}</Table.Cell>
                        <Table.Cell class="font-mono text-xs">{s.kind}{s.check_only ? " (check)" : ""}</Table.Cell>
                        <Table.Cell class="space-x-1 whitespace-nowrap">
                          {#if s.safety === "tx"}<Badge variant="destructive">TX</Badge>{/if}
                          {#if s.kind === "cat"}<Badge variant="outline">raw CAT</Badge>{/if}
                          <Badge variant="outline" title={s.readable ? "Can be read back, checked and restored" : "Can't be read back or restored automatically"}>{s.readable ? "readable" : "no readback"}</Badge>
                        </Table.Cell>
                        <Table.Cell class="font-mono text-xs">
                          <div>get: {s.rigctld.get ?? "—"}</div><div>set: {s.rigctld.set ?? "—"}</div>
                          {#if s.cat}<div class="text-muted-foreground mt-1">{s.cat.protocol} read {s.cat.read ?? "—"} · reply {s.cat.reply ?? "—"} · set {s.cat.set ?? "—"}</div>{/if}
                        </Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              </Card.Content>
            </Card.Root>
          {/if}
          {#if manual.length}
            <Card.Root>
              <Card.Header><Card.Title>On the radio</Card.Title><Card.Description>Menu settings CAT can't reach.</Card.Description></Card.Header>
              <Card.Content class="space-y-3">
                {#each manual as s}
                  <div><span class="font-mono text-sm">{s.manual?.menu}</span> → <b>{s.manual?.value}</b>{#if s.safety === "tx"} <Badge variant="destructive">TX</Badge>{/if}{@render refs(s.sources, s.confidence)}
                    {#if s.note}<span class="text-muted-foreground block text-xs">{s.note}</span>{/if}</div>
                {/each}
              </Card.Content>
            </Card.Root>
          {/if}
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
          {#if doc.sources?.length}
            <Card.Root id="sources">
              <Card.Header><Card.Title>Sources</Card.Title><Card.Description>Where these settings come from. Settings are facts; the credit goes to these authors.</Card.Description></Card.Header>
              <Card.Content>
                <ol class="space-y-1.5 text-sm">
                  {#each doc.sources as so}
                    <li id={`src-${so.id}`}><span class="text-muted-foreground font-mono text-xs">[{so.id}]</span>
                      {#if so.url}<a href={so.url} rel="noopener noreferrer nofollow" target="_blank">{so.title}</a>{:else}{so.title}{/if}{#if so.author}{" "}by <b>{so.author}</b>{/if}{#if so.date}{" "}({so.date}){/if}
                      {#if so.note}<span class="text-muted-foreground block text-xs">{so.note}</span>{/if}</li>
                  {/each}
                </ol>
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
          <p class="text-muted-foreground text-xs">Apply with <a href="https://github.com/open-rms/rigctlweb" rel="noopener noreferrer" target="_blank">rigctlWeb</a>: it reads your radio, shows what differs, applies the safe settings over CAT and can put them back.</p>
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
  </div>
{/if}
