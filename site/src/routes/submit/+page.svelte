<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { untrack } from "svelte";
  import { api, opLabel, type Issue, type ProfileDoc, type Rig } from "#lib/api.ts";
  import { me, signInUrl } from "#lib/auth.ts";
  import { clean, emptyDoc, fromText, toJson, toYaml } from "#lib/profile-doc.ts";
  import ProfileForm from "#lib/parts/ProfileForm.svelte";
  import ChangeList from "#lib/parts/ChangeList.svelte";
  import { diffDocs } from "#lib/diff.ts";
  import type { Envelope } from "#lib/api.ts";
  import * as Card from "#lib/components/ui/card/index.ts";
  import * as Tabs from "#lib/components/ui/tabs/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Textarea } from "#lib/components/ui/textarea/index.ts";

  let doc = $state<ProfileDoc>(emptyDoc());
  let rig = $state<Rig | null>(null);
  let ops = $state<string[]>([]);
  let editId = $state<string | null>(null);
  let tab = $state("form");
  let raw = $state("");
  let rawError = $state("");
  let errors = $state<Issue[]>([]);
  let warnings = $state<Issue[]>([]);
  let ok = $state(false);
  let checked = $state(false);
  let busy = $state(false);
  let result = $state("");
  let ready = $state(false);
  // Clone ("forked from"): the profile and revision we started from, and its document for the diff.
  let parent = $state<Envelope | null>(null);
  let original = $state<ProfileDoc | null>(null);
  const changes = $derived(original ? diffDocs(original, doc) : []);

  api.operations().then((o) => (ops = o.operations));

  // Start: edit an existing profile, or a new one (optionally for ?rig= and ?operation=).
  $effect(() => {
    const q = page.url.searchParams;
    untrack(async () => {
      const edit = q.get("edit");
      const fork = q.get("fork");
      if (fork) {
        const rev = Number(q.get("revision")) || undefined;
        parent = await api.profile(fork, rev);
        original = fromText(JSON.stringify(parent.document));
        const d = fromText(JSON.stringify(parent.document));
        d.title = `${parent.title} (my version)`.slice(0, 120);
        doc = d;
      } else if (edit) {
        editId = edit;
        doc = fromText(await api.yaml(edit));
      } else {
        const d = emptyDoc();
        const op = q.get("operation");
        if (op) d.operation = op;
        const macro = q.get("rig");
        if (macro) {
          const r = await api.rigForEditor(macro);
          d.rig = { macro: r.macro, hamlib_model: r.hamlib_model, mfg: r.mfg, name: r.name };
          d.title = `${r.name} ${opLabel(d.operation)}`;
          d.hamlib = `>=${r.hamlib.split(".").slice(0, 2).join(".")}`;
        }
        doc = d;
      }
      ready = true;
    });
  });

  // Load the selected radio's capabilities whenever it changes.
  $effect(() => {
    const macro = doc.rig.macro;
    if (!macro) { rig = null; return; }
    if (rig?.macro === macro) return;
    api.rigForEditor(macro).then((r) => (rig = r)).catch(() => (rig = null));
  });

  // Keep the raw editor in step when switching tabs.
  function onTab(v: string) {
    if (v === "yaml") raw = toYaml(doc);
    if (v === "json") raw = toJson(doc);
    rawError = "";
    tab = v;
  }
  function onRaw(text: string) {
    raw = text;
    try {
      doc = fromText(text);
      rawError = "";
    } catch (e) {
      rawError = (e as Error).message;
    }
  }

  // Live validation against the server (the same rules as submitting).
  let t: ReturnType<typeof setTimeout>;
  $effect(() => {
    const body = JSON.stringify(clean(doc));
    if (!ready) return;
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const r = await api.validate(body);
        ok = r.ok; errors = r.errors; warnings = r.warnings; checked = true;
      } catch (e) {
        ok = false; errors = [{ path: "/", message: (e as Error).message }]; warnings = []; checked = true;
      }
    }, 400);
  });

  /** Turns "/steps/3/value" into "RFPOWER: value" so form users can find the problem. */
  function where(path: string): string {
    const m = /^\/steps\/(\d+)(\/.*)?$/.exec(path);
    if (!m) return path === "/" ? "" : path.replace(/^\//, "").replaceAll("/", " › ");
    const s = doc.steps[Number(m[1])];
    return `${s ? s.name || s.kind : "step"}${m[2] ? ` › ${m[2].slice(1).replaceAll("/", " › ")}` : ""}`;
  }

  async function submit() {
    busy = true; result = "";
    try {
      const body = toJson(doc);
      const r = editId ? await api.update(editId, body) : await api.create(body, parent ? { id: parent.id, revision: parent.revision } : undefined);
      if (r.error) { errors = r.error.details ?? [{ path: "/", message: r.error.message }]; return; }
      goto(`/p/${r.id}`);
    } catch (e) { result = (e as Error).message; } finally { busy = false; }
  }

  function download(kind: "yaml" | "json") {
    const blob = new Blob([kind === "yaml" ? toYaml(doc) : toJson(doc)], { type: kind === "yaml" ? "application/yaml" : "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${doc.rig.name || "profile"}-${doc.operation}.${kind}`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-") });
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<h1 class="mb-1 text-2xl font-semibold">{editId ? "Edit profile" : parent ? "Clone and change a profile" : "Submit a profile"}</h1>
{#if parent}
  <div class="bg-primary-soft mb-4 max-w-3xl rounded-md border px-4 py-3 text-sm">
    Starting from <a href={`/p/${parent.id}`}><b>{parent.title}</b></a> (revision {parent.revision}) by {parent.author.callsign ?? "anonymous"}.
    Change only what's different for your station. The new profile shows <i>forked from</i> and links back, and the sidebar lists your changes.
  </div>
{/if}
<p class="text-muted-foreground mb-5 max-w-3xl text-sm">
  Pick your radio and the form offers only what Hamlib can check or set on it. Or switch to YAML or JSON and write it by hand (<a href="/api/v1/profile.schema.json">schema</a>, <a href="/developers">format guide</a>); both edit the same profile. Anything that can key the transmitter is refused. Profiles with raw CAT, and profiles from unverified callsigns, are reviewed by a moderator first.
</p>

<div class="grid gap-6 lg:grid-cols-[1fr_340px]">
  <Tabs.Root value={tab} onValueChange={onTab} class="flex-col">
    <Tabs.List>
      <Tabs.Trigger value="form">Form</Tabs.Trigger>
      <Tabs.Trigger value="yaml">YAML</Tabs.Trigger>
      <Tabs.Trigger value="json">JSON</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="form" class="pt-3">
      {#if ready}<ProfileForm bind:doc {rig} {ops} lockRig={!!editId} />{/if}
    </Tabs.Content>
    {#each ["yaml", "json"] as k}
      <Tabs.Content value={k} class="space-y-2 pt-3">
        <Textarea class="min-h-[65vh] font-mono text-xs" spellcheck={false} value={raw} oninput={(e) => onRaw((e.currentTarget as HTMLTextAreaElement).value)} />
        {#if rawError}<p class="text-destructive text-sm">Can't read this yet: {rawError}</p>{/if}
      </Tabs.Content>
    {/each}
  </Tabs.Root>

  <aside class="space-y-4 lg:sticky lg:top-4 lg:self-start">
    {#if parent}
      <Card.Root>
        <Card.Header><Card.Title>Changes from the original ({changes.length})</Card.Title></Card.Header>
        <Card.Content class="max-h-[35vh] overflow-auto"><ChangeList {changes} empty="Nothing changed yet. If the original works as-is, report it as worked instead of cloning." /></Card.Content>
      </Card.Root>
    {/if}
    <Card.Root>
      <Card.Header><Card.Title>{!checked ? "Checking…" : ok ? "✓ Ready to submit" : `${errors.length} problem${errors.length === 1 ? "" : "s"}`}</Card.Title></Card.Header>
      <Card.Content class="max-h-[50vh] space-y-2 overflow-auto text-sm">
        {#each errors as e}<div class="text-destructive">{#if where(e.path)}<b>{where(e.path)}:</b> {/if}{e.message}</div>{/each}
        {#each warnings as w}<div class="text-muted-foreground">{#if where(w.path)}<b>{where(w.path)}:</b> {/if}{w.message}</div>{/each}
        {#if ok && !warnings.length}<p class="text-muted-foreground">Checked against Hamlib's capabilities for this radio.</p>{/if}
      </Card.Content>
    </Card.Root>
    {#if $me}
      <Button class="w-full" disabled={!ok || busy || (!!parent && !changes.length)} onclick={submit}>{editId ? "Save new revision" : parent ? "Submit my version" : "Submit"}</Button>
    {:else}
      <Button class="w-full" variant="outline" href={signInUrl()}>Sign in to submit</Button>
    {/if}
    <div class="flex gap-2">
      <Button class="flex-1" variant="outline" size="sm" onclick={() => download("yaml")}>Download YAML</Button>
      <Button class="flex-1" variant="outline" size="sm" onclick={() => download("json")}>Download JSON</Button>
    </div>
    {#if result}<p class="text-destructive text-sm">{result}</p>{/if}
    <p class="text-muted-foreground text-xs">{doc.steps.length} step{doc.steps.length === 1 ? "" : "s"}: {doc.steps.filter((s) => s.kind !== "manual" && s.kind !== "cat").length} Hamlib, {doc.steps.filter((s) => s.kind === "cat").length} raw CAT, {doc.steps.filter((s) => s.kind === "manual").length} on the radio.</p>
  </aside>
</div>
