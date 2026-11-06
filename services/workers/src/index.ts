import { brokerTick } from "./brokerAgent";
import { CHAIN_ID, d, errMsg, log, syncClock } from "./ctx";
import { indexTick } from "./indexer";
import { keeperTick } from "./keeper";
import { oracleTick } from "./oracle";

/**
 * Runs the oracle (sessions and closes), the event indexer and notifier, the broker agents and the keeper.
 * `--once` runs one pass of each and exits (useful in scripts and tests). `--only=oracle,indexer` limits jobs.
 */
const once = process.argv.includes("--once");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

const jobs: { name: string; every: number; run: () => Promise<unknown> }[] = [
  { name: "indexer", every: 4_000, run: indexTick },
  { name: "oracle", every: 15_000, run: oracleTick },
  { name: "brokers", every: 15_000, run: brokerTick },
  { name: "keeper", every: 30_000, run: keeperTick },
].filter((j) => !only || only.includes(j.name));

async function loop(job: (typeof jobs)[number]) {
  for (;;) {
    try {
      await syncClock();
      await job.run();
    } catch (e) {
      log(job.name, errMsg(e));
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, job.every));
  }
}

log("workers", `chain ${CHAIN_ID}, calendar ${d.calendarMode}, jobs: ${jobs.map((j) => j.name).join(", ")}`);
if (once) {
  for (const j of jobs) await loop(j);
} else {
  await Promise.all(jobs.map(loop));
}
