/**
 * Generates typed ABIs from Foundry artifacts (contracts/out) into src/abis/*.ts.
 * Run `forge build` first. Usage: pnpm --filter @bullstreet/shared gen
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../../contracts/out");
const dest = join(here, "../src/abis");

const contracts: [string, string][] = [
  ["Directory", "directoryAbi"],
  ["Params", "paramsAbi"],
  ["SessionClock", "sessionClockAbi"],
  ["PriceOracle", "priceOracleAbi"],
  ["Compliance", "complianceAbi"],
  ["RoleRegistry", "roleRegistryAbi"],
  ["AssetFactory", "assetFactoryAbi"],
  ["StockToken", "stockTokenAbi"],
  ["BondVault", "bondVaultAbi"],
  ["BrokerRegistry", "brokerRegistryAbi"],
  ["LevelBook", "levelBookAbi"],
  ["PledgeRegistry", "pledgeRegistryAbi"],
  ["RedemptionEngine", "redemptionEngineAbi"],
  ["BullStreetExchange", "exchangeAbi"],
  ["MockUSDC", "mockUsdcAbi"],
];

const index: string[] = [];
for (const [name, exportName] of contracts) {
  const art = JSON.parse(readFileSync(join(out, `${name}.sol`, `${name}.json`), "utf8"));
  const file = exportName.replace(/Abi$/, "");
  writeFileSync(
    join(dest, `${file}.ts`),
    `// Generated from contracts/out/${name}.sol by scripts/gen-abis.ts. Do not edit.\nexport const ${exportName} = ${JSON.stringify(art.abi, null, 2)} as const;\n`,
  );
  index.push(`export { ${exportName} } from "./${file}";`);
}
writeFileSync(join(dest, "index.ts"), `// Generated. Do not edit.\n${index.join("\n")}\n`);
console.log(`wrote ${contracts.length} ABIs to ${dest}`);
