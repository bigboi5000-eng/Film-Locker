FROM denoland/deno:bin-2.1.4 AS deno_bin

FROM node:24-slim

# yt-dlp shells out to a JS runtime (deno, by default) to decipher YouTube's
# player signature/n-parameter challenges — without one, YouTube extraction
# silently loses most formats and downloads fail with "Requested format is
# not available". Copying the binary straight from Deno's own image avoids
# depending on deno.land's install script being reachable at build time.
COPY --from=deno_bin /deno /usr/local/bin/deno
RUN chmod a+rx /usr/local/bin/deno

# yt-dlp_linux (not the plain "yt-dlp" zipapp, which needs the system's
# Python to run) is a PyInstaller-built standalone binary that bundles
# curl_cffi, which TikTok's extractor needs to impersonate a real browser's
# TLS fingerprint — without it, yt-dlp warns "no impersonate target is
# available" and TikTok rejects the plain request outright ("Unexpected
# response from webpage request").
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates python3 \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production

# Apply pending migrations before serving, rather than leaving it as a manual
# step run from a laptop against a pasted connection string. Railway already
# holds the correct DATABASE_URL for this service, so the one environment that
# is guaranteed to have working credentials is the one doing the work.
#
# Drizzle records which migrations it has applied, so this is a no-op on every
# restart after the first. A failing migration takes the container down with
# it, which is the outcome we want: serving requests against a schema the code
# does not expect is worse than not serving them.
#
# `exec` on the server so it replaces the shell as PID 1 and still receives
# SIGTERM from Railway on shutdown.
CMD ["sh", "-c", "pnpm --filter @workspace/db run migrate && exec pnpm --filter @workspace/api-server run start"]
