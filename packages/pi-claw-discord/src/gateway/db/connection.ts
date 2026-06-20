import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { runSchemaMigrations } from "./schema.js";

let db: Database.Database | undefined;

export function initDb(): void {
	if (db) return;

	mkdirSync(dirname(config.dbPath), { recursive: true });
	db = new Database(config.dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");

	runSchemaMigrations(db);
	logger.info({ path: config.dbPath }, "Database initialized");
}

export function getDb(): Database.Database {
	if (!db) {
		throw new Error("Discord gateway database is not initialized");
	}
	return db;
}

export function closeDb(): void {
	if (!db) return;
	db.close();
	db = undefined;
}

export function normalizeTimestamp(timestamp: string | null): string | null {
	if (timestamp === null) {
		return null;
	}

	const parsed = new Date(timestamp);
	if (Number.isNaN(parsed.getTime())) {
		return timestamp;
	}

	return parsed.toISOString().slice(0, 19).replace("T", " ");
}
