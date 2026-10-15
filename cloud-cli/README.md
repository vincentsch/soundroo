# soundroo-cloud

The network half of Soundroo's optional sharing. The toolkit (`node bin/soundroo.js share`, `import`, `login`, …) prepares music and calls this tool; this tool performs every request to a Soundroo service. It is built on the [rungrad](https://github.com/vincentsch/rungrad) CLI framework (pinned to v0.3.2) and follows `rungrad-spec/1`. People who never share never need it. See [docs/sharing.md](../docs/sharing.md) for the user guide.

## Build and test

Go 1.22.2 or newer:

```bash
go build -o soundroo-cloud .
go vet ./...
go test ./...
```

The tests run every command against a stand-in service with the routes, resource shapes and errors of the Soundroo API, and `TestConformsToRungradSpec` builds the binary and scores it with rungrad's conformance runner. `node scripts/build-cloud.mjs --verify` (from the repository root) cross-builds Linux, macOS and Windows on amd64 and arm64 twice, requires identical bytes, and writes `dist/manifest.json` plus `dist/<version>/` (not tracked).

## Commands

| Command | Does |
| --- | --- |
| `publish --payload FILE --rights-accepted` | `POST /api/v1/releases` with the release file's bytes unchanged and an `Idempotency-Key`. Creates and stores a guest key first when none is stored (`--no-guest` refuses). `--wait` follows rendering. |
| `release show ID [--wait]` | `GET /api/v1/releases/{id}` |
| `auth status` | The resolved service and the key for it, masked. Local only. |
| `me` | `GET /api/v1/me` |
| `login [--start \| --wait]` | Device login: `POST /api/v1/device/code`, then polls `POST /api/v1/device/token` until approved on `/link` or the code expires. Prints the link; never opens a browser. |
| `claim-link` | `POST /api/v1/claim-links`: a fresh claim link for a guest page. |
| `claim --email ADDRESS` | `POST /api/v1/claim-email`: the service emails that address a link that claims the guest page; the person confirms once. Needs 0.2.0 or newer. |
| `logout --confirm [--local-only]` | `DELETE /api/v1/auth/token`, then removes this origin's stored key. |
| `track show \| update \| delete`, `collection show \| update` | Read and manage shared music. Updates and deletes need an account key; deletes need `--confirm`. `collection show` reports `canEdit`: whether the key it sent owns the collection, which the toolkit checks before updating a shared library. |
| `score ID` | `GET /api/v1/tracks/{id}/score`, kept as the service's raw JSON. |
| `meta`, `version` | Service engines and limits; this tool's version and JSON protocol. |

Global flags: `--json`, `--dry-run`, `--no-prompt`, `--quiet`, `--config`, `--service` (also `SOUNDROO_URL`). The key comes from `SOUNDROO_TOKEN`, else from the key stored for exactly the resolved origin in rungrad's owner-only `credentials.json`. Mutating commands preview under `--dry-run` without a key, a request or a configuration write. Errors under `--json` are one object on stderr: `{"error", "code", "exit_code", "status"?, "issues"?, "hint"?, "service_code"?}`. Exit codes are rungrad's 0–6.

`version --json` reports `protocol`. The toolkit refuses a binary whose protocol differs from the one it was written for; change `Protocol` only for an incompatible change of the JSON output.

## Distribution

A service offers builds at `/downloads/cli/manifest.json`:

```json
{
  "name": "soundroo-cloud",
  "version": "0.2.0",
  "protocol": 1,
  "platforms": {
    "linux-amd64": { "url": "0.2.0/soundroo-cloud_0.2.0_linux_amd64", "sha256": "…", "size": 9212039 }
  }
}
```

Platform keys are `linux`, `darwin` or `windows` with `amd64` or `arm64`. Each `url` resolves against the manifest's address and must stay on the same origin. The toolkit downloads only from the service the user chose, over HTTPS (HTTP only for loopback addresses), refuses redirects to other hosts, verifies size and SHA-256 while downloading, installs atomically into its cache and checks the file again before each run.
