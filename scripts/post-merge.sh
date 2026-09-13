#!/bin/bash
set -e

pnpm install --frozen-lockfile

# Migrate, not push.
#
# This previously ran `drizzle-kit push`, which reshapes whatever database
# DATABASE_URL points at to match the schema files and records nothing in
# Drizzle's migrations ledger. Some invocation of push is how production ended
# up holding every table from migration 0004 onwards while the ledger still
# read 0003 — which is what later made the deploy die on `relation
# "conversation_messages" already exists`, with 0009's runtime column never
# applied at all.
#
# It was probably not this hook: Replit runs it on merges through its git
# integration, and this project is only ever pulled from the Replit shell, so
# it may never have fired. That is exactly why it is worth changing now rather
# than later — a dormant line that reshapes the production database is one
# merge button away from mattering, and by then there are real lockers in it.
#
# `migrate` runs the same migrations production runs and records each one.
# lib/db/src/migrate.ts tolerates objects that already exist, so it reconciles
# a previously-pushed database instead of failing on it.
pnpm -C lib/db run migrate
