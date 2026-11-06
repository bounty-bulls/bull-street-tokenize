/** Runs one oracle pass (sessions and closes) against the configured chain. */
import { oracleTick } from "../services/workers/src/oracle";
oracleTick().then(() => process.exit(0), (e) => (console.error(e), process.exit(1)));
