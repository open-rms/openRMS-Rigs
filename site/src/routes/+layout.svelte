<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { api } from "#lib/api.ts";
  import { me, resetToken, signInUrl, signUpUrl } from "#lib/auth.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";
  let { children } = $props();

  const refreshMe = () => api.me().then((m) => me.set(m)).catch(() => me.set(null));
  onMount(() => {
    refreshMe();
    // Pick up a sign-in or sign-out done in another tab (the Accounts cookie is shared).
    const onVisible = () => { if (document.visibilityState === "visible") { resetToken(); refreshMe(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  });

  const nav = [
    { href: "/", label: "Profiles" },
    { href: "/submit", label: "Submit" },
    { href: "/developers", label: "API" },
  ];
</script>

<header class="bg-card mb-5 border-b">
  <div class="mx-auto flex min-h-14 max-w-[1200px] flex-wrap items-center gap-6 px-4">
    <a class="text-foreground flex items-center gap-2 text-[1.05rem] no-underline" href="/">
      <img src="/favicon.svg" alt="" width="26" height="26" />
      <span>openRMS <b>Rigs</b></span>
    </a>
    <nav class="flex flex-1 gap-4">
      {#each nav as n}
        <a href={n.href} aria-current={page.url.pathname === n.href ? "page" : undefined}
          class="text-muted-foreground aria-[current=page]:text-foreground aria-[current=page]:border-primary border-b-2 border-transparent py-1 no-underline">{n.label}</a>
      {/each}
    </nav>
    <div class="flex items-center gap-2">
      {#if $me}
        <a href="/favorites" class="text-sm">♥ Favorites</a>
        <a href="/account" class="no-underline"><Badge variant="secondary">{$me.callsign ?? "signed in"}</Badge></a>
        {#if $me.moderator}<a href="/account#queue" class="text-sm">Review queue</a>{/if}
      {:else}
        <Button size="sm" variant="outline" href={signInUrl()}>Sign in</Button>
        <a href={signUpUrl()} class="text-sm">Create account</a>
      {/if}
    </div>
  </div>
</header>

<main class="mx-auto max-w-[1200px] px-4 pb-16">
  {@render children()}
</main>

<footer class="text-muted-foreground mx-auto max-w-[1200px] border-t px-4 py-6 text-sm">
  Profiles are community-contributed under CC-BY-SA-4.0. Capabilities come from Hamlib. Check ALC and audio levels yourself before transmitting.
  · <a href="/docs">API docs</a> · Part of <a href="https://openrms.dev">openRMS</a>
</footer>
