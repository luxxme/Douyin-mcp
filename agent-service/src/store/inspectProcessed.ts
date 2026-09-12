import { loadConfig } from "../config/env.js";
import { ProcessedMessageRepository } from "./processedMessageRepository.js";
import { openAgentDatabase } from "./sqlite.js";

const config = loadConfig();
const database = openAgentDatabase(config.sqlitePath);

try {
  const repository = new ProcessedMessageRepository(database);
  const rows = repository.listRecent(20);
  console.table(rows);
  console.log(`Rows: ${repository.count()}`);
} finally {
  database.close();
}
