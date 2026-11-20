/**
 * schemaStatus.ts
 *
 * The result of the boot-time migration check, kept so /healthz can
 * report it.
 *
 * The check already ran and already logged, but a log line is only
 * readable by somebody with access to the deploy logs. That is a real
 * gap: "has the migration actually reached the database" is the first
 * question asked whenever an endpoint starts 500ing after a merge, and
 * answering it meant inferring from which endpoints happened to break
 * rather than just asking the server.
 *
 * Null until the check finishes — a boot-time query takes a moment and a
 * request can arrive first. Null means "not known yet", which is a
 * different answer from false and must not be rendered as one.
 */
export interface SchemaStatus {
  schemaUpToDate: boolean;
  latestMigration: string | null;
}

let current: SchemaStatus | null = null;

export function setSchemaStatus(status: SchemaStatus): void {
  current = status;
}

export function getSchemaStatus(): SchemaStatus | null {
  return current;
}
