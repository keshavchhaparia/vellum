# vellum-review

[github.com/keshavchhaparia/vellum](https://github.com/keshavchhaparia/vellum)

Turn any HTML artifact (a plan, diagram, comparison table, code diff, report —
whatever an AI agent just built) into a **local, in-browser review surface**
that the agent can poll for your annotations and feedback, and keep iterating
on with you in a loop.

It does the same job as hosted "artifact review" tools, but:

- **Zero runtime dependencies.** The whole thing is Node's built-in `http`,
  `fs`, `path`, `crypto`, `os`, and `child_process`. Nothing is fetched from
  npm at request time, so there's no supply chain to trust beyond this
  repo's own ~800 lines.
- **Nothing leaves your machine.** The server binds to `127.0.0.1` only.
  There is no "share to a public URL" feature and no telemetry.
- **MIT licensed**, small enough to read in one sitting.

## Install

```sh
npm install -g vellum-review
# or, without installing globally:
npx vellum-review <file.html>
```

## Usage

```sh
# 1. Open (or resume) a review session for an HTML artifact.
#    Starts a background daemon on 127.0.0.1 if one isn't already running,
#    and opens your default browser to it.
vellum path/to/artifact.html

# ...or open it for review from another device on the same network
# (phone, another laptop). No auth is added — only use this on a
# network you trust. This restarts the daemon on 0.0.0.0, so any other
# review session already open loses its in-memory state (see "How it
# works" below).
vellum path/to/artifact.html --lan

# 2. Long-poll for the reviewer's feedback (annotations + free-text message).
#    Blocks up to --timeout seconds (default 55), then returns whatever
#    was queued, or {"status":"timeout"} if nothing came in yet — just
#    call it again.
vellum poll path/to/artifact.html --agent-reply "Built the first draft, take a look"

# 3. Apply the feedback, edit the artifact file, then loop back to step 2.
#    Reloading the browser tab always re-reads the file from disk.

# 4. End the session when the review is done.
vellum end path/to/artifact.html

# Write a portable single-file copy (local assets inlined as data: URIs).
vellum export path/to/artifact.html --out path/to/artifact.portable.html

# Shut down the background daemon (it also self-stops after 30 min idle).
vellum stop
```

## How it works

- `bin/vellum.js` is the CLI. Most subcommands are a thin HTTP client to a
  background **daemon** (`src/daemon.js`) that it spawns detached on first
  use and that keeps session state in memory between CLI invocations.
- The daemon serves the artifact's HTML with a small annotation toolbar
  injected before `</body>` (`src/inject.js` + `public/toolbar.js`). In the
  browser you can toggle "Annotate", click any element to attach a note
  (a CSS selector for that element is generated client-side), or just type
  a free-text message, then hit "Send feedback".
- By default the daemon binds to `127.0.0.1` only. `--lan` makes it bind to
  `0.0.0.0` instead, and the returned URL uses the machine's detected LAN
  IPv4 address so another device can actually browse to it. Because the
  bind address can't change on a running server, requesting `--lan` while
  a loopback-only daemon is already up **restarts** the daemon — any other
  session's in-memory feedback queue/state is lost when that happens.
  Going the other direction (already in LAN mode, then a plain open
  without `--lan`) does **not** downgrade it back to loopback, so an
  already-connected device isn't silently cut off.
- Feedback is pushed into a per-session in-memory queue. `vellum poll` is a
  long-poll HTTP request that resolves as soon as something lands in that
  queue, or after the timeout — so an agent can sit in a `poll` → apply →
  `poll` loop without hammering the server.
- `vellum export` reads the artifact file and any locally-referenced
  `src`/`href` assets, inlines them as `data:` URIs, and writes a single
  portable HTML file. Remote (`http(s)://`) references are left as-is.
- The daemon self-stops after 30 minutes of inactivity, or immediately via
  `vellum stop`.

## Security posture

This project exists specifically to avoid the risk profile of "run
`npx some-third-party-cli`, which fetches and executes unpinned code from
the internet on every invocation, and can publish your artifact to a public
URL on a third-party host by default." Concretely:

- No `dependencies` in `package.json` — nothing to fetch or audit beyond
  this repo and Node itself.
- No outbound network requests anywhere in the code. The daemon only
  *listens*; it never calls out.
- Binds to `127.0.0.1` by default. The opt-in `--lan` flag trades that for
  cross-device convenience: it binds to `0.0.0.0` with no authentication
  layered on top, so treat it like any other unauthenticated local dev
  server — fine on a trusted home/office network, not for a coffee-shop
  Wi-Fi. Session URLs contain a random 16-hex-character id, which is
  unguessable but is not a substitute for real auth.
- No feature that uploads or publishes content off the local machine.
- Path handling for served assets and exported files is checked to stay
  within the artifact's own directory.

Read `src/daemon.js` — it's the entire attack surface, and it's short.

## Using this as an agent skill

If your agent tooling supports Markdown "skill" files, point the agent at
this CLI instead of `npx`-ing an unknown package: have it write the
artifact HTML, run `vellum <file>`, then loop on `vellum poll <file>` to
receive your feedback, exactly as documented above.

## License

MIT — see `LICENSE`.
