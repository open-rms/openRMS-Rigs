<script lang="ts">
  // Form editor for a profile, driven by what Hamlib says the selected radio can do
  // (GET /rigs/{macro}: caps + the profile hints the validator uses).
  import { api, opLabel, type ProfileDoc, type Rig, type RigSummary, type Step } from "#lib/api.ts";
  import { inputStep, newLevelStep, suggestMode, uniqueId } from "#lib/profile-doc.ts";
  import * as Card from "#lib/components/ui/card/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import { Label } from "#lib/components/ui/label/index.ts";
  import { NativeSelect } from "#lib/components/ui/native-select/index.ts";
  import { Textarea } from "#lib/components/ui/textarea/index.ts";
  import { Checkbox } from "#lib/components/ui/checkbox/index.ts";

  let { doc = $bindable(), rig, ops, lockRig = false }: { doc: ProfileDoc; rig: Rig | null; ops: string[]; lockRig?: boolean } = $props();

  // ---- radio picker ----
  let rigQ = $state("");
  let rigHits = $state<RigSummary[]>([]);
  let t: ReturnType<typeof setTimeout>;
  $effect(() => {
    const q = rigQ;
    clearTimeout(t);
    if (q.trim().length < 2) { rigHits = []; return; }
    t = setTimeout(() => api.rigs(q).then((r) => (rigHits = r.rigs.slice(0, 10))), 200);
  });
  function pickRig(r: RigSummary) {
    const keep = doc.rig.firmware;
    doc.rig = { macro: r.macro, hamlib_model: r.hamlib_model, mfg: r.mfg, name: r.name, ...(keep ? { firmware: keep } : {}) };
    // Hamlib steps belong to the old radio; manual, CAT and software steps are kept.
    doc.steps = doc.steps.filter((s) => s.kind === "manual" || s.kind === "cat");
    if (!doc.title) doc.title = `${r.name} ${opLabel(doc.operation)}`;
    rigQ = ""; rigHits = [];
  }

  // ---- helpers over doc.steps ----
  const find = (kind: Step["kind"], name: string) => doc.steps.find((s) => s.kind === kind && s.name === name);
  const remove = (s: Step) => (doc.steps = doc.steps.filter((x) => x !== s));
  const ctlOf = (s: Step) => (s.kind === "level" ? rig?.caps.levels.set[s.name] ?? rig?.caps.levels.get[s.name] : rig?.caps.parms.set[s.name] ?? rig?.caps.parms.get[s.name]);
  const isTx = (s: Step) => s.safety === "tx";

  // Mode
  const modeStep = $derived(find("mode", "MODE"));
  function setMode(m: string) {
    if (!m) { if (modeStep) remove(modeStep); return; }
    if (modeStep) modeStep.value = m;
    else doc.steps = [{ id: uniqueId(doc, "mode"), kind: "mode", name: "MODE", value: m, passband_hz: 0 }, ...doc.steps];
  }

  // Every level, function and parameter Hamlib can set (or read, for checks) on this radio.
  let filter = $state("");
  let onlySet = $state(false);
  const GROUPS: [string, RegExp][] = [
    ["Receive", /^(AF|RF|SQL|PREAMP|ATT|AGC|AGC_TIME|NR|NB|IF|PBT_IN|PBT_OUT|APF|NOTCHF|NOTCHF_RAW|USB_AF|BALANCE|SLOPE_LOW|SLOPE_HIGH)$/],
    ["Transmit", /^(RFPOWER|MICGAIN|COMP|VOXGAIN|VOXDELAY|ANTIVOX|MONITOR_GAIN|USB_AF_INPUT|TXEQ)$/],
    ["CW", /^(KEYSPD|CWPITCH|BKINDL|BKIN_DLYMS)$/],
    ["Scope and display", /^(SPECTRUM_.*|BACKLIGHT|METER)$/],
    ["Other", /./],
  ];
  const visible = (kind: Step["kind"], n: string) => n.toLowerCase().includes(filter.toLowerCase()) && (!onlySet || !!find(kind, n));
  const levelNames = $derived(rig ? [...new Set([...rig.profile.settable_levels, ...rig.profile.checkable_levels])].sort() : []);
  const levelGroups = $derived.by(() => {
    const left = new Set(levelNames.filter((n) => visible("level", n)));
    return GROUPS.map(([label, re]) => {
      const names = [...left].filter((n) => re.test(n));
      names.forEach((n) => left.delete(n));
      return [label, names] as const;
    }).filter(([, names]) => names.length);
  });
  const parmNames = $derived(rig ? [...new Set([...rig.profile.settable_parms, ...Object.keys(rig.caps.parms.get)])].sort().filter((n) => visible("parm", n)) : []);
  const funcNames = $derived(rig ? [...new Set([...rig.profile.settable_funcs, ...rig.profile.checkable_funcs])].sort().filter((n) => visible("func", n)) : []);
  const canSet = (kind: Step["kind"], n: string) =>
    !!rig && (kind === "level" ? rig.profile.settable_levels : kind === "parm" ? rig.profile.settable_parms : rig.profile.settable_funcs).includes(n);
  const canCheck = (kind: Step["kind"], n: string) =>
    !!rig && (kind === "level" ? rig.profile.checkable_levels.includes(n) : kind === "parm" ? n in rig.caps.parms.get : rig.profile.checkable_funcs.includes(n));
  const stateOf = (kind: Step["kind"], n: string) => { const s = find(kind, n); return !s ? "" : s.check_only ? "check" : "set"; };
  function setLevelState(kind: "level" | "parm", n: string, v: string) {
    const s = find(kind, n);
    if (!v) { if (s) remove(s); return; }
    if (s) { s.check_only = v === "check"; return; }
    if (!rig) return;
    const st = newLevelStep(doc, rig, kind, n);
    st.check_only = v === "check";
    doc.steps = [...doc.steps, st];
  }
  const setCount = (kind: Step["kind"]) => doc.steps.filter((s) => s.kind === kind).length;

  // Functions: tri-state per function
  function funcState(name: string): string {
    const s = find("func", name);
    return !s ? "" : s.check_only ? "check" : s.value ? "on" : "off";
  }
  function setFunc(name: string, v: string) {
    const s = find("func", name);
    if (!v) { if (s) remove(s); return; }
    const next: Step = { id: s?.id ?? uniqueId(doc, name), kind: "func", name, value: v === "on" || (v === "check" && !!s?.value),
      ...(v === "check" ? { check_only: true } : {}), ...(rig?.profile.tx_funcs.includes(name) ? { safety: "tx" as const } : {}), ...(s?.note ? { note: s.note } : {}) };
    doc.steps = s ? doc.steps.map((x) => (x === s ? next : x)) : [...doc.steps, next];
  }

  // Manual, CAT, software
  const manualSteps = $derived(doc.steps.filter((s) => s.kind === "manual"));
  const catSteps = $derived(doc.steps.filter((s) => s.kind === "cat"));
  function addManual() {
    doc.steps = [...doc.steps, { id: uniqueId(doc, "manual"), kind: "manual", name: "", manual: { menu: "", value: "" } }];
  }
  function addCat() {
    doc.steps = [...doc.steps, { id: uniqueId(doc, "cat"), kind: "cat", name: "", cat: { protocol: rig?.profile.cat_protocol ?? "ascii", read: "", reply: "", set: "" } }];
  }
  function addSoftware() { doc.software = [...(doc.software ?? []), { app: "", setting: "", value: "" }]; }

  // Small conversions for inputs
  const num = (e: Event) => { const v = (e.currentTarget as HTMLInputElement).value; return v === "" ? undefined : Number(v); };
  function setExpect(s: Step, key: "min" | "max", v: number | undefined) {
    s.expect = { ...(s.expect ?? {}), [key]: v };
    if (v === undefined) delete s.expect[key];
  }
  function setNot(s: Step, text: string) {
    const vals = text.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (isNaN(Number(x)) ? x : Number(x)));
    s.expect = { ...(s.expect ?? {}), not: vals };
    if (!vals.length) delete s.expect.not;
  }
  function catValues(s: Step, text: string) {
    const entries = text.split(",").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p.length === 2 && p[0]);
    s.cat!.values = Object.fromEntries(entries);
  }
  const catValuesText = (s: Step) => Object.entries(s.cat?.values ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
  let tagsText = $state(doc.tags?.join(", ") ?? "");
  $effect(() => { doc.tags = tagsText.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); });
  const hamlibMinor = $derived(rig ? `>=${rig.hamlib.split(".").slice(0, 2).join(".")}` : ">=4.6");
</script>

{#snippet settingRow(kind: "level" | "parm", n: string)}
  {@const s = find(kind, n)}
  {@const ctl = rig ? (kind === "level" ? rig.caps.levels.set[n] ?? rig.caps.levels.get[n] : rig.caps.parms.set[n] ?? rig.caps.parms.get[n]) : undefined}
  {@const settable = canSet(kind, n)}
  <div class={["px-3 py-2", s && "bg-primary-soft/40"]}>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="w-40 font-mono text-sm">{n}</span>
      <span class="text-muted-foreground w-44 text-xs">
        {ctl?.choices ? ctl.choices.join(" / ") : ctl?.range ? `${ctl.range.min} … ${ctl.range.max}` : n === "AGC" && rig && Object.keys(rig.caps.agc_levels).length ? Object.values(rig.caps.agc_levels).join(" / ") : "no range from Hamlib"}
        {#if ctl?.unit && ctl.unit !== "hamlib" && !ctl.unit.includes(" ")} · {ctl.unit}{/if}
      </span>
      {#if rig?.profile.tx_levels.includes(n)}<Badge variant="destructive">TX</Badge>{/if}
      <span class="flex-1"></span>
      <NativeSelect class="w-32" value={stateOf(kind, n)} onchange={(e) => setLevelState(kind, n, (e.currentTarget as HTMLSelectElement).value)}>
        <option value="">—</option>
        {#if settable}<option value="set">Set</option>{/if}
        {#if canCheck(kind, n)}<option value="check">Check</option>{/if}
      </NativeSelect>
    </div>
    {#if s}
      <div class="mt-2 grid gap-3 md:grid-cols-[1fr_140px_160px]">
        {#if n === "AGC" && !ctl?.range && rig && Object.keys(rig.caps.agc_levels).length}
          <NativeSelect value={String(s.value ?? "")} onchange={(e) => (s.value = Number((e.currentTarget as HTMLSelectElement).value))}>
            {#each Object.entries(rig.caps.agc_levels) as [k, label]}<option value={k}>{label} ({k})</option>{/each}
          </NativeSelect>
          <span></span>
        {:else if ctl?.choices}
          <NativeSelect bind:value={s.value}>{#each ctl.choices as c}<option>{c}</option>{/each}</NativeSelect>
          <span></span>
        {:else if ctl?.range}
          <input type="range" class="accent-primary w-full" min={ctl.range.min} max={ctl.range.max} step={inputStep(ctl.range)} bind:value={s.value} />
          <Input type="number" min={ctl.range.min} max={ctl.range.max} step={inputStep(ctl.range)} bind:value={s.value} />
        {:else}
          <Input type="number" step="any" bind:value={s.value} /><span></span>
        {/if}
        <Input placeholder={'display, e.g. "~35 W"'} bind:value={s.display} />
      </div>
      <details class="mt-2 text-sm" open={!!s.check_only}>
        <summary class="text-muted-foreground cursor-pointer text-xs">{s.check_only ? "What counts as OK" : "Acceptable values for checks"}, note</summary>
        <div class="mt-2 grid gap-2 md:grid-cols-3">
          <Input type="number" step="any" placeholder="min" value={s.expect?.min ?? ""} oninput={(e) => setExpect(s, "min", num(e))} />
          <Input type="number" step="any" placeholder="max" value={s.expect?.max ?? ""} oninput={(e) => setExpect(s, "max", num(e))} />
          <Input placeholder="must not be (comma list)" value={s.expect?.not?.join(", ") ?? ""} oninput={(e) => setNot(s, (e.currentTarget as HTMLInputElement).value)} />
          <Input class="md:col-span-3" placeholder="Note: why this value" bind:value={s.note} />
        </div>
      </details>
    {/if}
  </div>
{/snippet}

<div class="space-y-5">
  <!-- Radio and purpose -->
  <Card.Root>
    <Card.Header><Card.Title>Radio and purpose</Card.Title></Card.Header>
    <Card.Content class="grid gap-4 md:grid-cols-2">
      <div class="grid gap-1.5 md:col-span-2">
        <Label>Radio</Label>
        {#if doc.rig.macro}
          <div class="flex flex-wrap items-center gap-2">
            <Badge>{doc.rig.mfg} {doc.rig.name}</Badge>
            <span class="text-muted-foreground text-xs">Hamlib model {doc.rig.hamlib_model} · <code>{doc.rig.macro}</code>{rig ? ` · catalog Hamlib ${rig.hamlib}` : ""}</span>
          </div>
        {/if}
        {#if !lockRig}
          <Input placeholder={doc.rig.macro ? "Change radio…" : "Search: IC-7300, FTDX-10, K3…"} bind:value={rigQ} />
          {#if rigHits.length}
            <ul class="bg-card divide-y rounded-md border text-sm">
              {#each rigHits as r}<li><button type="button" class="hover:bg-muted w-full px-3 py-2 text-left" onclick={() => pickRig(r)}>{r.mfg} {r.name} <span class="text-muted-foreground text-xs">({r.status})</span></button></li>{/each}
            </ul>
          {/if}
        {:else}
          <p class="text-muted-foreground text-xs">A new revision can't change the radio.</p>
        {/if}
      </div>
      <div class="grid gap-1.5"><Label for="f-title">Title</Label><Input id="f-title" bind:value={doc.title} placeholder="IC-7300 FT8 over the built-in USB codec" /></div>
      <div class="grid gap-1.5">
        <Label for="f-op">Operation</Label>
        <NativeSelect id="f-op" class="w-full" bind:value={doc.operation}>{#each ops as o}<option value={o}>{opLabel(o)}</option>{/each}</NativeSelect>
      </div>
      <div class="grid gap-1.5 md:col-span-2"><Label for="f-sum">Summary</Label><Textarea id="f-sum" rows={2} bind:value={doc.summary} placeholder="What it's for and what it was tested with" /></div>
      <div class="grid gap-1.5">
        <Label for="f-conn">Connection</Label>
        <NativeSelect id="f-conn" class="w-full" bind:value={doc.connection}>{#each ["usb", "lan", "serial", "bluetooth", "other"] as c}<option>{c}</option>{/each}</NativeSelect>
      </div>
      <div class="grid gap-1.5"><Label for="f-if">Interface</Label><Input id="f-if" bind:value={doc.interface} placeholder="built-in USB codec, SignaLink USB…" /></div>
      <div class="grid gap-1.5">
        <Label for="f-hl">Hamlib versions tested</Label>
        <div class="flex gap-2"><Input id="f-hl" bind:value={doc.hamlib} placeholder=">=4.6 <4.8" /><Button type="button" variant="outline" size="sm" onclick={() => (doc.hamlib = hamlibMinor)}>{hamlibMinor}</Button></div>
      </div>
      <div class="grid gap-1.5"><Label for="f-fw">Radio firmware (optional)</Label><Input id="f-fw" bind:value={doc.rig.firmware} placeholder=">=1.40" /></div>
    </Card.Content>
  </Card.Root>

  {#if !rig}
    <p class="text-muted-foreground text-sm">Pick a radio to see the settings Hamlib can check and set on it.</p>
  {:else}
    <!-- Mode -->
    <Card.Root>
      <Card.Header><Card.Title>Mode</Card.Title><Card.Description>The modes Hamlib supports on the {rig.name}.</Card.Description></Card.Header>
      <Card.Content class="flex flex-wrap items-end gap-4">
        <div class="grid gap-1.5">
          <Label for="f-mode">Mode</Label>
          <NativeSelect id="f-mode" value={(modeStep?.value as string) ?? ""} onchange={(e) => setMode((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">Don't set</option>
            {#each rig.caps.modes as m}<option>{m}</option>{/each}
          </NativeSelect>
        </div>
        {#if modeStep}
          <div class="grid gap-1.5"><Label for="f-pb">Passband (Hz, 0 = radio default)</Label><Input id="f-pb" type="number" min="0" step="50" class="w-40" bind:value={modeStep.passband_hz} /></div>
        {:else}
          {@const sug = suggestMode(rig, doc.operation)}
          {#if sug}<Button type="button" variant="outline" size="sm" onclick={() => setMode(sug)}>Use {sug} for {opLabel(doc.operation)}</Button>{/if}
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- All settings Hamlib exposes for this radio -->
    <Card.Root>
      <Card.Header>
        <Card.Title>Settings Hamlib can reach on the {rig.name}</Card.Title>
        <Card.Description>
          Every level, function and parameter rigctld can set or read on this radio. Choose <b>Set</b> to have apps apply a value, or <b>Check</b> to have apps only verify it.
          Values are Hamlib units (RFPOWER is a 0–1 fraction, not watts; use "display" for people).
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-6">
        <div class="flex flex-wrap items-center gap-4">
          <Input placeholder="Filter, e.g. AGC, NB, KEYSPD…" bind:value={filter} class="max-w-xs" />
          <label class="flex items-center gap-2 text-sm"><Checkbox checked={onlySet} onCheckedChange={(v) => (onlySet = v)} /> Only show what's in the profile</label>
          <span class="text-muted-foreground text-xs">{setCount("level")} levels · {setCount("func")} functions · {setCount("parm")} parameters in the profile</span>
        </div>

        {#each levelGroups as [label, names]}
          <section>
            <h3 class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">{label} levels</h3>
            <div class="divide-y rounded-md border">
              {#each names as n (n)}{@render settingRow("level", n)}{/each}
            </div>
          </section>
        {/each}

        {#if funcNames.length}
          <section>
            <h3 class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">Functions</h3>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {#each funcNames as f (f)}
                {@const settable = canSet("func", f)}
                <div class={["flex items-center justify-between gap-2 rounded-md border px-3 py-1.5", find("func", f) && "border-primary"]}>
                  <span class="font-mono text-sm">{f}{#if rig.profile.tx_funcs.includes(f)} <Badge variant="destructive">TX</Badge>{/if}</span>
                  <NativeSelect class="w-28" value={funcState(f)} onchange={(e) => setFunc(f, (e.currentTarget as HTMLSelectElement).value)}>
                    <option value="">—</option>
                    {#if settable}<option value="on">Set on</option><option value="off">Set off</option>{/if}
                    <option value="check">Check</option>
                  </NativeSelect>
                </div>
              {/each}
            </div>
            {#if rig.profile.refused_funcs.length}
              <p class="text-muted-foreground mt-2 text-xs">Hamlib can also switch {rig.profile.refused_funcs.join(", ")} on this radio, but profiles never include them: they can key the transmitter.</p>
            {/if}
          </section>
        {/if}

        {#if parmNames.length}
          <section>
            <h3 class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">Parameters (radio-wide)</h3>
            <div class="divide-y rounded-md border">
              {#each parmNames as n (n)}{@render settingRow("parm", n)}{/each}
            </div>
          </section>
        {/if}
        {#if !levelGroups.length && !funcNames.length && !parmNames.length}<p class="text-muted-foreground text-sm">Nothing matches.</p>{/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Manual steps -->
  <Card.Root>
    <Card.Header><Card.Title>On the radio</Card.Title><Card.Description>Menu settings CAT can't reach, like USB MOD level or network setup. Shown to people as a checklist.</Card.Description></Card.Header>
    <Card.Content class="space-y-3">
      {#each manualSteps as s (s.id)}
        <div class="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_2fr_1fr_auto]">
          <Input placeholder="Name, e.g. USB MOD level" bind:value={s.name} />
          <Input placeholder="Menu path, e.g. MENU > SET > Connectors > USB MOD Level" bind:value={s.manual!.menu} />
          <Input placeholder="Value" bind:value={s.manual!.value} />
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs"><Checkbox checked={isTx(s)} onCheckedChange={(v) => (s.safety = v ? "tx" : "rx")} /> TX</label>
            <Button type="button" variant="ghost" size="sm" onclick={() => remove(s)}>Remove</Button>
          </div>
          <Input class="md:col-span-4" placeholder="Note (optional)" bind:value={s.note} />
        </div>
      {/each}
      <Button type="button" variant="outline" size="sm" onclick={addManual}>+ Add a menu step</Button>
    </Card.Content>
  </Card.Root>

  <!-- Raw CAT -->
  <details class="bg-card rounded-lg border" open={catSteps.length > 0}>
    <summary class="cursor-pointer px-6 py-4 font-medium">Advanced: raw CAT commands ({catSteps.length})</summary>
    <div class="space-y-3 px-6 pb-5">
      <p class="text-muted-foreground text-sm">
        For menu items Hamlib can't reach, sent through rigctld's <code>send_cmd</code>. Only settings command families are allowed (no transmit, tune or send), and profiles with raw CAT are reviewed by a moderator.
        {rig?.profile.cat_protocol === "civ" ? "Icom: CI-V body in hex, without FE FE, addresses or FD." : "Text commands ending in ';'."} Use <code>{"{value}"}</code> or <code>{"{value:03}"}</code> in the set template.
      </p>
      {#each catSteps as s (s.id)}
        <div class="grid gap-2 rounded-md border p-3 md:grid-cols-4">
          <Input placeholder="Name, e.g. DATA OUT LEVEL" bind:value={s.name} />
          <NativeSelect bind:value={s.cat!.protocol}><option value="ascii">ascii</option><option value="civ">CI-V</option></NativeSelect>
          <Input placeholder="Value" bind:value={s.value} />
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-1.5 text-xs"><Checkbox checked={!!s.check_only} onCheckedChange={(v) => (s.check_only = v)} /> Check only</label>
            <label class="flex items-center gap-1.5 text-xs"><Checkbox checked={isTx(s)} onCheckedChange={(v) => (s.safety = v ? "tx" : "rx")} /> TX</label>
          </div>
          <Input class="font-mono" placeholder={'read, e.g. "EX010413;"'} bind:value={s.cat!.read} />
          <Input class="font-mono" placeholder={'reply regex, e.g. ^EX010413(\\d{3});$'} bind:value={s.cat!.reply} />
          <Input class="font-mono" placeholder={'set, e.g. "EX010413{value:03};"'} bind:value={s.cat!.set} />
          <Input placeholder="values: 0=OFF, 1=FAST" value={catValuesText(s)} oninput={(e) => catValues(s, (e.currentTarget as HTMLInputElement).value)} />
          <Input class="md:col-span-3" placeholder="Note" bind:value={s.note} />
          <Button type="button" variant="ghost" size="sm" onclick={() => remove(s)}>Remove</Button>
        </div>
      {/each}
      <Button type="button" variant="outline" size="sm" onclick={addCat}>+ Add a CAT command</Button>
    </div>
  </details>

  <!-- Software -->
  <Card.Root>
    <Card.Header><Card.Title>Software settings</Card.Title><Card.Description>WSJT-X, fldigi, Pat, ardopcf, PipeWire…</Card.Description></Card.Header>
    <Card.Content class="space-y-2">
      {#each doc.software ?? [] as sw, i}
        <div class="grid gap-2 md:grid-cols-[140px_1fr_1fr_auto]">
          <Input placeholder="app" bind:value={sw.app} />
          <Input placeholder="setting" bind:value={sw.setting} />
          <Input placeholder="value" bind:value={sw.value} />
          <Button type="button" variant="ghost" size="sm" onclick={() => (doc.software = doc.software!.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      {/each}
      <Button type="button" variant="outline" size="sm" onclick={addSoftware}>+ Add a software setting</Button>
    </Card.Content>
  </Card.Root>

  <!-- Audio and notes -->
  <Card.Root>
    <Card.Header><Card.Title>Levels to aim for, notes</Card.Title></Card.Header>
    <Card.Content class="grid gap-3 md:grid-cols-2">
      <div class="grid gap-1.5">
        <Label for="f-rx">Receive audio target (dBFS noise floor)</Label>
        <Input id="f-rx" type="number" max="0" step="1" placeholder="-25" value={doc.audio?.rx_target_dbfs ?? ""}
          oninput={(e) => (doc.audio = { ...(doc.audio ?? {}), rx_target_dbfs: num(e) })} />
      </div>
      <div class="grid gap-1.5"><Label for="f-tags">Tags</Label><Input id="f-tags" placeholder="pota, single-cable" bind:value={tagsText} /></div>
      <div class="grid gap-1.5"><Label for="f-rxn">Receive note</Label><Input id="f-rxn" value={doc.audio?.rx_note ?? ""} oninput={(e) => (doc.audio = { ...(doc.audio ?? {}), rx_note: (e.currentTarget as HTMLInputElement).value })} /></div>
      <div class="grid gap-1.5"><Label for="f-txn">Transmit note</Label><Input id="f-txn" placeholder="ALC stays at zero" value={doc.audio?.tx_note ?? ""} oninput={(e) => (doc.audio = { ...(doc.audio ?? {}), tx_note: (e.currentTarget as HTMLInputElement).value })} /></div>
      <div class="grid gap-1.5 md:col-span-2"><Label for="f-notes">Notes (Markdown)</Label><Textarea id="f-notes" rows={4} bind:value={doc.notes} /></div>
    </Card.Content>
  </Card.Root>

  <!-- Sources -->
  <Card.Root>
    <Card.Header><Card.Title>Sources</Card.Title><Card.Description>Credit where the settings came from (manuals, articles, your own on-air testing). Record values as facts with a link; don't paste text from the source. Steps can cite these by id in YAML (<code>sources: [S1]</code>).</Card.Description></Card.Header>
    <Card.Content class="space-y-2">
      {#each doc.sources ?? [] as so, i (so.id)}
        <div class="grid gap-2 md:grid-cols-[52px_1.4fr_1fr_1.4fr_auto]">
          <span class="text-muted-foreground self-center font-mono text-xs">[{so.id}]</span>
          <Input placeholder="Title" bind:value={so.title} />
          <Input placeholder="Author" bind:value={so.author} />
          <Input placeholder="https://…" bind:value={so.url} />
          <Button type="button" variant="ghost" size="sm" onclick={() => (doc.sources = doc.sources!.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      {/each}
      <Button type="button" variant="outline" size="sm" onclick={() => {
        const used = new Set((doc.sources ?? []).map((s) => s.id));
        let n = 1; while (used.has(`S${n}`)) n++;
        doc.sources = [...(doc.sources ?? []), { id: `S${n}`, title: "" }];
      }}>+ Add a source</Button>
    </Card.Content>
  </Card.Root>
</div>
