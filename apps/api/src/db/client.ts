import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { loadConfig } from "../config.js";
import * as schema from "./schema.js";

const config = loadConfig();
const sqlite = new Database(config.databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { sqlite };

