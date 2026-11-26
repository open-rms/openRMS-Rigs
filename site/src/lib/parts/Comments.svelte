<script lang="ts">
  // Comment thread for a profile. Bodies are rendered as plain text (Svelte escapes them).
  import { api, ApiError, type Comment } from "#lib/api.ts";
  import { me, signInUrl } from "#lib/auth.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Textarea } from "#lib/components/ui/textarea/index.ts";
  import { Badge } from "#lib/components/ui/badge/index.ts";

  let { profileId, onCount }: { profileId: string; onCount?: (n: number) => void } = $props();
  let comments = $state<Comment[]>([]);
  let draft = $state("");
  let replyTo = $state<number | null>(null);
  let replyDraft = $state("");
  let editing = $state<number | null>(null);
  let editDraft = $state("");
  let error = $state("");
  let busy = $state(false);

  async function load() {
    const r = await api.comments(profileId);
    comments = r.comments;
    onCount?.(r.count);
  }
  $effect(() => { void profileId; void $me; load(); });

  async function run(fn: () => Promise<unknown>) {
    busy = true; error = "";
    try { await fn(); await load(); } catch (e) { error = e instanceof ApiError ? e.message : String(e); } finally { busy = false; }
  }
  const post = () => run(async () => { await api.postComment(profileId, draft); draft = ""; });
  const reply = (id: number) => run(async () => { await api.postComment(profileId, replyDraft, id); replyDraft = ""; replyTo = null; });
  const save = (id: number) => run(async () => { await api.editComment(id, editDraft); editing = null; });
  const del = (id: number) => run(() => api.deleteComment(id));
  const hide = (c: Comment) => run(() => api.hideComment(c.id, !c.hidden));
  const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

{#snippet one(c: Comment, isReply: boolean)}
  <div class={["py-3", isReply && "border-l-2 pl-4"]}>
    <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
      <b class="text-foreground">{c.author.callsign ?? (c.deleted ? "deleted" : c.hidden ? "hidden" : "anonymous")}</b>
      <span>{when(c.created_at)}</span>
      {#if c.edited_at}<span>· edited</span>{/if}
      <span>· on revision {c.revision}</span>
      {#if c.hidden}<Badge variant="outline">hidden by a moderator</Badge>{/if}
      {#if c.deleted}<Badge variant="outline">deleted</Badge>{/if}
    </div>
    {#if editing === c.id}
      <Textarea class="mt-2" rows={3} bind:value={editDraft} maxlength={4000} />
      <div class="mt-1 flex gap-2"><Button size="sm" disabled={busy || !editDraft.trim()} onclick={() => save(c.id)}>Save</Button><Button size="sm" variant="ghost" onclick={() => (editing = null)}>Cancel</Button></div>
    {:else if c.body !== null}
      <p class={["mt-1 text-sm break-words whitespace-pre-line", (c.hidden || c.deleted) && "text-muted-foreground line-through"]}>{c.body}</p>
    {:else}
      <p class="text-muted-foreground mt-1 text-sm italic">{c.deleted ? "Deleted by its author." : "Hidden by a moderator."}</p>
    {/if}
    {#if $me && !c.deleted && editing !== c.id}
      <div class="mt-1 flex gap-3 text-xs">
        {#if !isReply && !c.hidden}<button class="text-muted-foreground hover:text-foreground" onclick={() => { replyTo = c.id; replyDraft = ""; }}>Reply</button>{/if}
        {#if c.mine && !c.hidden}<button class="text-muted-foreground hover:text-foreground" onclick={() => { editing = c.id; editDraft = c.body ?? ""; }}>Edit</button>{/if}
        {#if c.mine || $me.moderator}<button class="text-muted-foreground hover:text-destructive" onclick={() => del(c.id)}>Delete</button>{/if}
        {#if $me.moderator}<button class="text-muted-foreground hover:text-foreground" onclick={() => hide(c)}>{c.hidden ? "Unhide" : "Hide"}</button>{/if}
      </div>
    {/if}
    {#if replyTo === c.id}
      <div class="mt-2 space-y-1">
        <Textarea rows={2} placeholder="Reply…" bind:value={replyDraft} maxlength={4000} />
        <div class="flex gap-2"><Button size="sm" disabled={busy || !replyDraft.trim()} onclick={() => reply(c.id)}>Reply</Button><Button size="sm" variant="ghost" onclick={() => (replyTo = null)}>Cancel</Button></div>
      </div>
    {/if}
    {#each c.replies ?? [] as r (r.id)}{@render one(r, true)}{/each}
  </div>
{/snippet}

<div class="space-y-4">
  {#if $me}
    <div class="space-y-2">
      <Textarea rows={3} placeholder="Ask a question, share what you changed, or say what worked on your station (firmware, interface, cable)…" bind:value={draft} maxlength={4000} />
      <div class="flex items-center gap-3">
        <Button disabled={busy || !draft.trim()} onclick={post}>Comment</Button>
        <span class="text-muted-foreground text-xs">Plain text. Be kind; moderators can hide comments.</span>
      </div>
    </div>
  {:else}
    <Button variant="outline" href={signInUrl()}>Sign in to comment</Button>
  {/if}
  {#if error}<p class="text-destructive text-sm">{error}</p>{/if}
  <div class="divide-y">
    {#each comments as c (c.id)}{@render one(c, false)}{:else}<p class="text-muted-foreground py-3 text-sm">No comments yet.</p>{/each}
  </div>
</div>
