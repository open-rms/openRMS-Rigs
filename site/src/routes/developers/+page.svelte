<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.ts";
  const base = typeof location !== "undefined" ? `${location.origin}/api/v1` : "/api/v1";
</script>

<h1 class="mb-1 text-2xl font-semibold">API and format</h1>
<p class="text-muted-foreground mb-6 max-w-3xl">Everything on this site goes through a public, versioned JSON API. Reads need no account and send ETags for offline caching. <a href="/docs">Interactive docs</a> · <a href="/api/v1/openapi.yaml">OpenAPI 3.1</a> · <a href="/api/v1/profile.schema.json">Profile JSON Schema</a></p>

<div class="grid gap-4 md:grid-cols-2">
  <Card.Root><Card.Header><Card.Title>Find profiles</Card.Title></Card.Header><Card.Content class="space-y-1 font-mono text-xs">
    <div>GET {base}/rigs?q=7300</div><div>GET {base}/rigs/RIG_MODEL_IC7300</div><div>GET {base}/profiles?rig=RIG_MODEL_IC7300&amp;operation=ft8</div><div>GET {base}/profiles/&#123;id&#125;.yaml</div><div>GET {base}/dump.json</div>
  </Card.Content></Card.Root>
  <Card.Root><Card.Header><Card.Title>Apply safely</Card.Title></Card.Header><Card.Content class="space-y-2 text-sm">
    <div class="font-mono text-xs">GET {base}/profiles/&#123;id&#125;/apply-plan<br />POST {base}/profiles/&#123;id&#125;/check</div>
    <p>Read each readable step from the radio, post the values to <code>/check</code>, show the diff, ask before <code>safety: tx</code> steps, snapshot, apply, offer restore. Plans never contain anything that keys the transmitter.</p>
  </Card.Content></Card.Root>
  <Card.Root><Card.Header><Card.Title>Tools</Card.Title></Card.Header><Card.Content class="space-y-1 font-mono text-xs">
    <div>POST {base}/validate (YAML or JSON body)</div><div>POST {base}/convert?to=yaml</div>
  </Card.Content></Card.Root>
  <Card.Root><Card.Header><Card.Title>Contribute from an app</Card.Title></Card.Header><Card.Content class="text-sm">
    Sign in through openRMS Accounts (device flow for desktop apps), or mint an <code>ormsr_</code> key on your account page, and <code>POST {base}/profiles</code>.
  </Card.Content></Card.Root>
</div>
