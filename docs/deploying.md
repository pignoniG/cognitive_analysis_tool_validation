# Running it on a server

The same program can run in Docker on a server, so the sessions are saved there, on a disk that survives new
deployments, while the page is used from the lab computer (monitor or headset). Nothing about a session changes:
the page, the files and the timing are the same. Two things are added: the server keeps the files, and the page
measures the offset between the server's clock and the computer's.

!!! note "Not yet run on a server"
    The image and the compose files were written and checked without Docker at hand: the server, the password, the
    data folder, the clock offset and a sub-path proxy (a stand-in for nginx) were all tested, but the image was not
    built. Build it once and run a short session before relying on it (open issue 9).

## What runs where

| | The lab computer (browser) | The server (container) |
|---|---|---|
| Shows the stimuli, plays the audio, takes the responses | yes | |
| Eye tracker, headset and physiology recordings | yes, on its own clock | |
| Keeps a copy of every session file | in the page (downloadable) | `DATA_DIR`, row by row as it happens |
| Serves the page | | yes |

The timing of a session is the browser's: the server only receives rows. A slow or interrupted connection never
delays the stimulus; if it fails, the page keeps everything in memory and offers the files for download at the end,
as without a server.

## Quick start

On the server, with Docker and Docker Compose:

```sh
git clone https://github.com/pignoniG/cognitive_analysis_tool_validation.git
cd cognitive_analysis_tool_validation
cp .env.example .env            # then set VALIDATION_PASSWORD (a long random one)
mkdir -p data && sudo chown 10001:10001 data
docker compose up -d --build
```

The page is on the server's `127.0.0.1:8765` only (set `VALIDATION_PORT` to change it). To use it from the lab
computer without any public address, open an SSH tunnel and browse to <http://localhost:8765>; `localhost` counts as a
secure context, so WebXR works:

```sh
ssh -L 8765:localhost:8765 user@server
```

The browser asks for the password once (any user name).

## Behind an existing nginx, with HTTPS

WebXR (the headset), audio and window management need HTTPS or `localhost`. If the server already has an nginx in
Docker serving a site over HTTPS (for example `https://137-204-97-86.sslip.io`), the task can sit under a path of the
same host name and certificate, at `/validation/`. Nothing is published and no certificate is needed. The pages use
only relative addresses, so the path prefix needs no setting.

1. **Find the proxy's Docker network:** `docker inspect <the nginx container> --format '{{json .NetworkSettings.Networks}}'`
   (or `docker network ls`).
2. **Start the task on that network:**

    ```sh
    PROXY_NETWORK=<network> docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
    ```

3. **Teach nginx about it.** Put [`deploy/nginx-validation.conf`](https://github.com/pignoniG/cognitive_analysis_tool_validation/blob/main/deploy/nginx-validation.conf)
   where that nginx reads its location snippets, make sure the nginx container is on the same network, then test and
   reload: `docker exec <nginx> nginx -t && docker exec <nginx> nginx -s reload`. The snippet strips `/validation/`,
   looks the container up through Docker's DNS when a request comes (so nginx still starts if the task is down) and
   allows saves up to 20 MB.
4. **Open** `https://<host>/validation/` (with the trailing slash; without it nginx redirects).

The snippet was written without sight of the server, from a description of its files. Check the paths and network
names against the real ones, and let the existing site keep its own rules: the new location touches nothing else.

## The password

`VALIDATION_PASSWORD` protects the page and every save (HTTP Basic, any user name). Over HTTPS the password is
encrypted in transit; over plain HTTP it is not, so on a public server use it only behind HTTPS. If the proxy in
front already asks for a password, leave the variable empty. `GET /healthz` never asks, for container health checks.

What the server will and will not do, whatever the password:

- it serves only the page's own files (`index.html`, `stimulus.html`, `src/`, `assets/`, `vendor/`, `docs/`): never
  the data folder, the server's code or hidden files, and no directory listings;
- it writes only inside the data folder, to `.csv`, `.json` or `.txt` files with checked names, up to 20 MB per
  save and 200 MB per file;
- it never deletes anything: a save appends to a file or replaces only the one file it names.

## Where the results are

Each session is a folder in `DATA_PATH` on the host (default `./data`, mounted as `/data` in the container):

```
data/P01_screen_setA_2026-10-28_12-06-03/    a monitor session, visual set A
data/P01_vr_setB_2026-10-28_14-30-00/        a headset session, set B
data/P01_practice_2026-10-28_11-50-12/       the n-back practice
```

Each holds the files of [the session](running.md#files), plus `clock_offset.csv` (below). The folder is outside the
image, so `docker compose up --build`, `down` and a new deployment (`git pull`, rebuild) never touch it. Copy it out
with `rsync -a user@server:/path/to/data/ ./results/`, and back it up like any data. To use a Docker volume instead
of a host folder, change the `volumes` line of `docker-compose.yml` to `validation-data:/data` and declare it under
`volumes:`. A volume also survives `down`, but not `down -v`; a host folder survives both.

The folder must be writable by the container's user (`uid 10001`, set in the Dockerfile): `chown 10001:10001 data`, or
set `DATA_UID` and `DATA_GID` in `.env` to your own. If a save fails (a full disk, a wrong permission), the *Saving*
line on the control page turns red and the files are rewritten whole at the end and offered for download.

## The clock offset

The files carry the **lab computer's** clock (Unix time from the browser), because that is the clock the eye tracker
and the physiology recordings are matched to. The server's clock is a different one. The page measures the offset
between them and only records it, never changes any time:

- **When:** before the session starts, every minute while it runs, and when it ends (8 round trips at the start and
  the end, 5 in between). The control page shows it on the *Clock* line.
- **How:** each round trip asks the server for its time (`GET api/time`); the offset is the server's time minus the
  middle of the round trip, and the trip with the shortest delay is kept, because a short trip leaves the least room
  for the two directions to differ (the error is at most half its round trip, shown as `rtt_ms / 2`).
- **Without a server** (the page opened from a static host, or the server unreachable) nothing is measured, and
  `session.json` says so.

`clock_offset.csv`, one row per measurement:

| Column | Meaning |
|---|---|
| `phase` | `start`, `during` or `end` |
| `session_s` | the session time, empty at the start |
| `measured_at_unix_ms` | the middle of the round trip, on the lab computer's clock |
| `offset_ms` | **server minus lab computer**, in ms |
| `rtt_ms`, `samples`, `spread_ms` | the round trip kept, the number tried, and how far the three shortest trips disagreed |
| `server_unix_ms` | the server's clock at that moment |
| `page_vs_wall_ms` | the computer's wall clock minus the page's own: not zero if the computer's clock was stepped (for example by an NTP update) after the page was opened |

`session.json` has a `clock` entry with the first and last offsets, the largest uncertainty, the drift per minute and the
convention. **To put a session's times on the server's clock:**

```
server_unix_ms = logged_unix_ms + offset_ms
```

For example, with the event log:

```python
import json, pandas as pd
session = json.load(open("session.json"))
offset_s = session["clock"]["start"]["offset_ms"] / 1000       # or the mean of the rows of clock_offset.csv
events = pd.read_csv("2026-Oct-28_12-06-03_event_log.csv")
events["Start (unix s), server"] = events["Start (unix s)"] + offset_s
```

If the offset is a few milliseconds, as between machines that both follow NTP, it can be ignored. A large or drifting
offset (seconds, or more than about 1 ms per minute) is the sign of a clock that should be fixed, and the control page
shows it in red.

## Updating, checking and stopping

```sh
git pull && docker compose up -d --build      # a new version; the data folder is untouched
docker compose ps                              # "healthy" once the check passes
docker compose logs -f validation              # one line per save
docker compose down                            # stops it; the data stays
```

The image holds the page, the audio and the scenes (about 200 MB) and nothing else; it has no secrets.
