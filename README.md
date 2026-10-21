# Sphinx

Outsource your thinking, not your understanding.

Sphinx adds an understanding check to agent-assisted development. When you push to a protected branch, Git waits while Sphinx asks you to predict what your change will do. If you miss something, it explains and gives you a new scenario to try. Once you pass, the same push continues. This works whether you or a coding agent ran `git push`.

The questions come from a separate reviewer model. It reads the committed change through read-only Git tools and does not see the conversation that produced the code.

## What a check looks like

This is an illustrative exchange for a change that adds a background job queue:

> **Question.** The worker commits the operation but crashes before acknowledging the job. After redelivery, can the operation happen twice? Give a short reason.
>
> **Your answer.** No, the job is marked done when the operation commits.
>
> **Sphinx.** Not quite. The job is only marked done by the acknowledgement, which happens after the commit. A crash between the two leaves it unacknowledged, so the queue delivers it again and the operation runs a second time.
>
> **New scenario.** A worker stalls past the visibility timeout, so a second worker receives the same job. Both commit before either acknowledges. What stops a duplicate, if anything?

Questions cover behavior, failure modes, and invariants rather than file names or function names. The check is open-book: you can read the code, or ask your agent to show it to you, while you answer.

## Before you install

- **Requirements.** Node.js 22.19 or newer, Git, and macOS, Linux, or WSL. Native Windows is not supported yet.
- **It applies to every repository on this machine.** `sphinx install` sets your global Git `core.hooksPath`. Your existing hooks still run first. Right after install, pushes to `main` or `master` in any repository are checked. `sphinx init` lets you adjust that for each repository.
- **It blocks Git.** A matching push waits until you pass, pause, or skip, for up to 25 minutes. Your coding agent's shell may time out sooner.
- **You need a reviewer model account.** This can be a signed-in Codex or Claude Code CLI, which uses that plan's allowance. It can also be an OpenRouter API key, which bills separately and is required even for free models, or any [OpenAI-compatible endpoint](docs/configuration.md#openai-compatible-endpoints). Sphinx has no account or hosted service of its own.
- **Code leaves your machine.** The reviewer provider receives the changed code and related files from the commit, your answers, and `.sphinxcontext.md`. Ignored files are never read, and `.env` files, private keys, and common credential files are excluded by default. Add your own sensitive paths to `.sphinxignore` before your first check. Ignore rules match file paths, so they will not catch a secret pasted into ordinary source.
- **There is no default cap on model calls.** A typical check makes about 5 to 8 requests, plus about one per answer. You can [set a cap](docs/configuration.md#model-calls-tokens-and-limits), and you should set spending limits with paid providers.
- **This is practice, not a security gate.** Anyone with local access, including a coding agent, can bypass hooks or get outside help. Passing does not prove who wrote the code or that you understood it unaided. The examiner is an LLM and can be wrong.

## Quick start

### 1. Install (required)

```sh
npm install -g sphinx-understand
sphinx install
```

Guided setup asks which coding agents you use and which reviewer to use. It suggests Haiku through Claude Code or GPT-6 Luna through Codex. If you choose OpenRouter, it asks for an API key. It then offers the recommended checkpoints (pushes to `main` or `master` at standard depth) or **Customize** to pick events, branches, remotes, and depth. To install without prompts:

```sh
sphinx install --yes --preset claude-economy --agents claude
```

You should see:

```text
✓ Git hooks installed for this user. Existing hooks are chained.
✓ Claude Code native questionnaire hooks and Sphinx MCP server installed.
```

Use `--preset codex-economy` for Codex, or `--agents none` if you don't use a coding agent. Other presets, OpenRouter, OpenAI-compatible endpoints, and custom routes are covered in [configuration](docs/configuration.md#reviewer-models).

### 2. Load Sphinx in your coding agent (required if you use one)

Guided setup opens your selected agents in fresh sessions. Then:

- **Codex:** open `/hooks` and trust the Sphinx hooks. Sphinx cannot do or verify this for you.
- **Claude Code:** start a new session. `/mcp` should show `sphinx` connected.
- **Pi, Cursor, OpenCode:** see [per-client notes](docs/integrations.md#per-client-notes).

If you skip this step, the Git checkpoint still works. However, your agent won't know it should wait for a blocked push, and the fallback forms used when the browser can't open won't be available.

### 3. Set up a repository (required)

```sh
cd your-repo
sphinx init
```

This asks which branches and events to check and how deep the questions should go. Then it creates three files without overwriting existing ones:

- `.sphinxconfig`: the repository's policy.
- `.sphinxignore`: paths that are never read. **Edit this now** if the repository has private or generated files.
- `.sphinxcontext.md`: a short description of what the project does, which every reviewer request receives. Leave out secrets.

To set it up without prompts:

```sh
sphinx init --yes --branches main
```

Commit the three files to share the policy with collaborators.

### 4. Check the setup (recommended)

```sh
sphinx doctor
```

It should end with `✓ Configured integrations are in place.` and exit with status 0. If not, it says what needs attention, such as a repository with its own hooks directory. Fix that with `sphinx install --repo`.

### 5. Push and pass your first check

```sh
git push origin main
```

Git prints the questionnaire address and waits:

```text
Sphinx: understanding check needed for refs/heads/main (medium change).
Sphinx: Git is waiting for your answers in the local Sphinx questionnaire. It will continue automatically after you pass. Do not start another copy of this Git operation.
Sphinx questionnaire: http://127.0.0.1:56114/fSdZM7yg…
Sphinx: questionnaire opened in a background browser tab. Your coding window stays in place.
```

On macOS, the page opens in a background browser tab. On Linux, WSL, and over SSH, Git prints `open the local URL above to answer` instead, so open the printed address yourself. From a remote session, forward the same port and open the URL unchanged, or run `sphinx check`; see [remote machines](docs/integrations.md#remote-machines-ssh-and-ci). Questions can take a moment while the reviewer reads the change, and the page shows its progress as it works. Beside each question, the page shows the checkpoint's changed files, lines added and removed, a browsable diff, and the code locations the reviewer read for that question. Answer each question with a prediction and a short reason. When you pass:

```text
Sphinx: understanding check complete. Continuing this Git operation.
To github.com:you/your-repo.git
 * [new branch]      main -> main
```

Pushing the same change again does not ask again. A pass lasts 24 hours, unless the code, destination, or policy changes.

## During and after a check

- **Wrong answer.** You get an explanation and a new scenario about the same concept. Disputes and errors never count as passing.
- **Explain this.** Shows the concept and asks you a new question.
- **Dispute question.** Use this if a question's premise is wrong or ambiguous. A bad question must be corrected before that concept can pass.
- **Pause check.** Saves your progress and stops the push. Run the same `git push` later to pick up where you left off.
- **Closing the tab** doesn't stop anything. Git keeps waiting, and the same address works until the 25-minute deadline.
- **Skip this time.** Lets the push through immediately, even while the review is still running. Skips never count as passing.
- **`sphinx yolo`** turns checks off for the current repository, or globally when run outside one. Run it again to turn checks back on. A repository's own setting wins over the global one, so turning yolo off inside a repository keeps checks on there even while global yolo is on. `--reason "prod hotfix"` is optional.
- **`sphinx check`** runs the same check in your terminal instead of the browser.

Every skip and yolo toggle is logged with its reason, and `sphinx status` lists recent ones. If Git exited before you finished, for example because your agent's shell timed out, run the push once more. Never start a second copy while one is still waiting. For more cases, see [troubleshooting](docs/integrations.md#troubleshooting).

Your answers go straight from the page to Sphinx. Your coding agent sees only the check's status, progress, and usage, never your answers.

## Limits and cost

Question count depends on the size of the change and the depth you choose. Small changes get one question, and large ones get up to three at the default depth. After commits, Sphinx prepares questions in the background, so they are often ready by the time you push. Calls, tokens, and (when reported) cost appear in the questionnaire.

```sh
sphinx config --max-model-calls 30        # optional cap per check (1–100)
sphinx config --preset openrouter-value --allow-paid
```

Context size, output tokens, and review time are always capped. Transient provider errors (rate limits, an OpenRouter route without a JSON-schema provider, brief outages) are retried up to three times with backoff; an answer that still could not be graded is saved for when you resume. For routing thresholds, model tables, pricing, and every limit, see [configuration and cost](docs/configuration.md).

Version 0.1 checks local commits and pushes only. It does not cover web merges, CI-required checks, or deployments. It cannot read binary file contents, and it tests understanding rather than auditing the code. The [evaluation results](eval/RESULTS.md) record question quality, grading errors, and costs on synthetic changes. They do not certify arbitrary repositories.

## Commands

| Command | Use it to |
| --- | --- |
| `install` | Set up machine-wide Git hooks and agent integrations |
| `init` | Create this repository's policy, ignore, and context files |
| `doctor` | Check hook and integration coverage |
| `status` | Show this repository's policy, pending checks, and recent skips |
| `check` | Start or resume a check in the terminal (`--staged` for commits) |
| `pending` | List unfinished checks |
| `yolo` | Toggle skipping checks |
| `config` | Change reviewer models and limits |
| `auth` | Save your OpenRouter key or an OpenAI-compatible endpoint |
| `prepare` | Schedule background preparation (`--retry` after a failure) |
| `activate` | Open configured coding agents without reinstalling |
| `uninstall` | Remove Sphinx integrations, keeping unrelated settings |

Each command explains itself with `sphinx <command> --help`. `--json` gives machine-readable output, and `NO_COLOR=1` turns off color.

## Reference

- [Configuration and cost](docs/configuration.md): reviewer models, OpenRouter, pricing, routing, limits, `.sphinxconfig`, `.sphinxignore`, project context, and background preparation.
- [Integrations and troubleshooting](docs/integrations.md): Codex, Claude Code, Pi, Cursor, OpenCode, fallback forms, SSH, existing hooks, the JSON protocol, and uninstalling.
- [Architecture](docs/architecture.md): the checkpoint sequence, the reviewer and its evidence, compaction, and state.
- [Evaluation](eval/README.md) and [results](eval/RESULTS.md).

## Development

```sh
npm ci
npm test
npm run eval -- --out /tmp/sphinx-eval.json
node bin/sphinx.js --help
npm install -g .   # use this checkout as the installed sphinx
```

Tests use Node's test runner, real temporary Git repositories, isolated homes, and fixture model backends. The suite makes no live model requests. Never run installer tests against a real home directory or Git configuration. See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
