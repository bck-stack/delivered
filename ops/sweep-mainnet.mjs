// After judging ends: send what is left in the provider and evaluator gas wallets on Arc back to the owner.
// Run by the owner:  node sweep-mainnet.mjs           -> shows balances, sends nothing
//                    node sweep-mainnet.mjs send      -> sends everything except the fee of the transfer itself
// After this the evaluator can no longer settle jobs, so run it only when the demo can stop.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, defineChain, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = readFileSync("C:/Users/mandi/Desktop/projeler/tekleme işler/.env.delivered-mainnet", "utf8");
const get = (k) => env.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1).trim();
const OWNER = "0xb8491F953e6860D3b5840b73c60883Ff099ceAfA";
const chain = defineChain({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } } });
const pub = createPublicClient({ chain, transport: http() });
const send = process.argv[2] === "send";

for (const name of ["PROVIDER_KEY", "EVALUATOR_KEY"]) {
  const account = privateKeyToAccount(get(name));
  const balance = await pub.getBalance({ address: account.address });
  const gasPrice = await pub.getGasPrice();
  const fee = gasPrice * 21000n * 2n;  // a plain transfer, with headroom
  const amount = balance > fee ? balance - fee : 0n;
  console.log(`${name.replace("_KEY", "").toLowerCase()} ${account.address}: ${formatEther(balance)} USDC, can send ${formatEther(amount)}`);
  if (!send || amount === 0n) continue;
  const wallet = createWalletClient({ account, chain, transport: http() });
  const hash = await wallet.sendTransaction({ to: OWNER, value: amount });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  sent: https://explorer.arc.io/tx/${hash}`);
}
if (!send) console.log("\nNothing sent. Run with 'send' to move these balances to", OWNER);
