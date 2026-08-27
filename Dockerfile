FROM denoland/deno:bin-2.1.4 AS deno_bin

FROM node:24-slim

# yt-dlp shells out to a JS runtime (deno, by default) to decipher YouTube's
# player signature/n-parameter challenges — without one, YouTube extraction
# silently loses most formats and downloads fail with "Requested format is
# not available". Copying the binary straight from Deno's own image avoids
# depending on deno.land's install script being reachable at build time.
COPY --from=deno_bin /deno /usr/local/bin/deno
RUN chmod a+rx /usr/local/bin/deno

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates python3 \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]
