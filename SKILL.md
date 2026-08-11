---
name: vellum
description: Turn complex or visual agent responses into rich, reviewable HTML artifacts the user can annotate and send feedback on, using the local vellum CLI (vellum-review). Use when about to give a plan, comparison, diagram, table, code diff, report, or anything easier to grasp visually than as prose. Everything stays on this machine — no third-party service is involved.
argument-hint: <what the artifact should show>
author: vellum-review — github.com/keshavchhaparia/vellum, MIT licensed
metadata:
  tags: [html, review, artifacts, visualization, local-first]
  category: productivity
---

# Vellum

Vellum is an in-house, MIT-licensed, zero-runtime-dependency replacement for
third-party "artifact review" skills that shell out to `npx some-cli`. It
gives you the same loop — build an HTML artifact, hand it to the user for
annotation in the browser, poll for their feedback, iterate — but the
server is ~800 lines of code in this repo, it binds only to `127.0.0.1` by
default, it never fetches unpinned code at request time, and there is no
"publish to a public URL" feature. Source: `vellum-review`
(github.com/keshavchhaparia/vellum — see its README for the full security
rationale).

This is the canonical copy of the skill. If you're consuming vellum from
another project, copy or symlink this file into that project's skill
directory (e.g. `.agents/skills/vellum/SKILL.md`) rather than forking it —
fix bugs and add capabilities here, not in a per-project copy, so they
don't drift out of sync with each other or with the CLI's actual behavior.

Whenever you are about to give the user a complex response that would be
easier to understand as a rich / interactive page, consider using Vellum.
First generate an interactive HTML artifact according to the user's
request, then run `vellum <html-file>` so the user can visually review it,
annotate elements or leave a free-text note, and send feedback back through
`vellum poll <html-file>`.

`vellum` is a normal locally-installed CLI (`npm install -g vellum-review`,
or `npm link`ed from a local checkout) — no `npx` of a remote package is
involved. If `vellum` is not on PATH, fall back to
`node <path-to-checkout>/bin/vellum.js`.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked `/vellum` explicitly —
build an HTML artifact for that request now, following the workflow below.
If it is empty, infer what to visualize from the conversation.

## When to use

Use vellum when the user asks for a visual artifact, HTML explainer,
interactive prototype, review surface, product or technical plan,
comparison, report, or browser-based feedback loop.

## Workflow

1. Create the HTML artifact (default location `.vellum/<name>.html` in the
   working directory).
2. Run `vellum <html-file>` to open or resume a review session. This
   starts a local background daemon bound to `127.0.0.1` if one isn't
   already running, and opens the user's default browser to it. Print the
   URL in your reply either way — don't rely solely on the auto-opened tab.
3. Run `vellum poll <html-file>` to long-poll for the user's annotations
   and feedback. On the first poll, pass
   `--agent-reply "<one-line summary of what you built and what to review first>"`
   so the browser panel shows context immediately.
   The poll blocks for up to `--timeout` seconds (default 55) and returns
   `{"status":"ok","items":[...]}` once the user sends something, or
   `{"status":"timeout","items":[]}` if nothing came in — just call it
   again. It is a single request/response, not a background process, so
   there is nothing to keep alive or avoid killing.
4. If poll returns items, apply the user's feedback (each item has a
   `message` and/or an `annotations` array of `{selector, label, note}` —
   `selector` is a best-effort CSS selector for the element the user
   clicked). Edit the artifact file; the browser tab re-reads it from disk
   on reload.
5. Poll again with `--agent-reply "<message>"` to keep the loop going.
6. Run `vellum end <html-file>` when the review is finished. This is a
   soft end — a later plain `vellum <html-file>` resumes it. If the user
   ends the session from the browser chrome instead, a later
   `vellum <html-file>` needs `--reopen` to resume it; respect that and
   don't reopen an unfinished session uninvited.

## Visual guidance

- Use visual hierarchy to make the most important decisions, risks,
  tradeoffs, and next actions obvious at a glance.
- Use visual structure such as sections, cards, tables, diagrams, annotated
  snippets, and side-by-side comparisons instead of long prose.
- Choose typography, spacing, color, and layout deliberately so the
  artifact has a clear point of view.
- Prevent horizontal overflow at every nesting level: nested grid/flex
  children also need `minmax(0, 1fr)` tracks and `min-width: 0`, especially
  when badges, labels, or status text use wide pixel or monospace fonts;
  wrap, truncate, or contain long unbreakable text deliberately.
- When the artifact would describe existing or current UI or state, show
  it instead: capture screenshots of the real pages (run the app read-only
  if needed) and embed them, rather than explaining the current look in
  prose; reserve prose for what cannot be shown, such as rationale,
  trade-offs, and open questions.
- For flows, architecture, state, or sequence diagrams, prefer a
  theme-aware Mermaid snippet over hand-built div/flexbox boxes-and-arrows,
  unless SVG is needed for richly annotated nodes.

## Commands & rules

- `vellum <html-file> [--reopen] [--lan]` — open or resume a session.
  `--lan` binds the daemon to `0.0.0.0` instead of `127.0.0.1` so a review
  device other than this machine (phone, another laptop) can reach it —
  it has no authentication, so only use it on a network you and the
  reviewer trust. Some agent harnesses run their shell/Bash tool inside an
  isolated network namespace of its own; in that case even a plain
  `127.0.0.1` session can be unreachable from the user's actual browser on
  the *same* machine, and `--lan` is required rather than merely
  convenient — if you hit that, or the user has already told you their
  environment needs it, default to always passing `--lan` for that project
  and say so once rather than rediscovering it each session. Pass
  `--reopen` only when the user asks for further review after they
  explicitly ended the session from the browser. Restarting drops the
  in-memory state of any other open session — avoid mixing LAN and
  non-LAN sessions in the same conversation; pick one mode up front.
- Unless the user specifies another location, create HTML artifacts under
  `.vellum/` in the current working directory.
- If the artifact references other filesystem assets (images, CSS, fonts,
  local scripts), keep them in the same directory as the HTML file and
  reference them with relative paths — the daemon serves siblings of the
  artifact file under `/view/<id>/assets/...`. Never use a root-absolute
  path (`/foo.png`) — it won't resolve.
- `vellum poll <html-file> [--agent-reply "<msg>"] [--timeout <seconds>]` —
  wait for feedback. Safe to call repeatedly; queued feedback is never
  dropped between polls.
- `vellum end <html-file>` — end a session as the agent.
- `vellum export <html-file> [--out <path>]` — write a portable, single-file
  copy with local sibling assets inlined as `data:` URIs (remote refs are
  left as links, so those still need network to render). There is no
  "share to a public URL" command — if the user wants to hand the artifact
  to someone else, use `export` and let them send the file themselves, or
  a project-specific hosted-artifact tool if a shareable link is actually
  wanted.
- `vellum stop` — shut down the background daemon (it also self-stops
  after 30 minutes idle).
- Vellum does not auto-inject a design system. Before writing HTML: (1) if
  the user asked for a specific look, use that; (2) otherwise match the
  design system of the project the artifact is *about* (Tailwind/theme
  config, shared CSS variables, component library, brand assets); (3) only
  if both come up empty, hand-roll clean, deliberate CSS — keep it
  self-contained (inline `<style>`, no CDN fetch) so the artifact still
  renders identically when exported or opened without the daemon running.
