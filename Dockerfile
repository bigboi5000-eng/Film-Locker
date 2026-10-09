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
# Which release to install. "latest" tracks whatever yt-dlp has shipped most
# recently, which is usually what you want — extractors break when platforms
# change and the fixes only arrive in new releases.
#
# The cost is that an image rebuild can change the binary with nothing in the
# repository to show it, so a platform that stops working gives no way to
# tell a new block from a version regression. Set YT_DLP_VERSION to a release
# tag to pin it (Railway: a service variable, or --build-arg locally). The
# version in use is logged on startup — see logYtDlpDiagnostics in
# artifacts/api-server/src/index.ts — which is where to read the tag to pin.
ARG YT_DLP_VERSION=latest

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates python3 \
    && if [ "$YT_DLP_VERSION" = "latest" ]; then \
         YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"; \
       else \
         YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux"; \
       fi \
    && curl -fL "$YT_DLP_URL" -o /usr/local/bin/yt-dlp \
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
# `-C lib/db` rather than `--filter @workspace/db`: a filter that matches no
# package makes pnpm print a warning and exit 0, so the migration step would
# be skipped silently and the server would start anyway against an outdated
# schema. `-C` on a missing directory fails loudly instead. (Note that a start
# command set in the host's dashboard overrides this CMD entirely — the
# schema check the server logs on boot exists to catch that case.)
#
# `exec` on the server so it replaces the shell as PID 1 and still receives
# SIGTERM from Railway on shutdown.
CMD ["sh", "-c", "pnpm -C lib/db run migrate && exec pnpm -C artifacts/api-server run start"]
