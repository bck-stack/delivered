// Arc mainnet launch, run once by the owner after funding the provider wallet:
//   1. deploys the Delivered contract compiled in Arc Studio (same bytecode as the tested testnet deployment),
//   2. writes its address into studio/scripts/config.ts,
//   3. runs Arc Studio's setup-provider script: ERC-8004 identity, delivery signer, payout address.
// Spends only gas from the provider wallet (a few cents of USDC on Arc).
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createPublicClient, createWalletClient, http, defineChain, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = readFileSync("C:/Users/mandi/Desktop/projeler/tekleme işler/.env.delivered-mainnet", "utf8");
const get = (k) => env.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const PAYOUT = "0xb8491F953e6860D3b5840b73c60883Ff099ceAfA";
const REPUTATION = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
const chain = defineChain({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } } });
const pub = createPublicClient({ chain, transport: http() });
const account = privateKeyToAccount(get("PROVIDER_KEY"));
const wallet = createWalletClient({ account, chain, transport: http() });

const balance = await pub.getBalance({ address: account.address });
console.log(`Provider wallet ${account.address}: ${formatEther(balance)} USDC`);
if (balance < 200000000000000000n) throw new Error("Provider wallet needs at least 0.2 USDC on Arc mainnet for gas. Nothing was sent.");

const artifact = JSON.parse(readFileSync(`${ROOT}studio/contracts/out/Delivered.sol/Delivered.json`, "utf8"));
console.log("\n[deploy] Delivered on Arc mainnet...");
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [REPUTATION] });
console.log(`  tx: https://explorer.arc.io/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("deploy failed");
const contract = receipt.contractAddress;
console.log(`  contract: https://explorer.arc.io/address/${contract}`);

const cfgPath = `${ROOT}studio/scripts/config.ts`;
writeFileSync(cfgPath, readFileSync(cfgPath, "utf8").replace(/deliveredAddress: '0x0{40}', \/\/ TODO: fill after mainnet deploy/, `deliveredAddress: '${contract}',`));
writeFileSync(`${ROOT}ops/mainnet.json`, JSON.stringify({ contract, deployTx: hash, provider: account.address, payout: PAYOUT, at: new Date().toISOString() }, null, 2));

console.log("\n[setup] provider identity, signer and payout...");
execFileSync("npx", ["tsx", "scripts/setup-provider.ts"], {
  cwd: `${ROOT}studio`, stdio: "inherit", shell: true,
  env: { ...process.env, NETWORK: "mainnet", PROVIDER_KEY: get("PROVIDER_KEY"), PAYOUT_ADDRESS: PAYOUT },
});
console.log("\nDone. Tell Claude: \"ana ağ kurulumu bitti\".");
