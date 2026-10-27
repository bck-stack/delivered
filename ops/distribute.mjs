// Testnet only: sends test USDC from the provider wallet to the evaluator and buyer wallets.
import { parseEther } from "viem";
import { get, pub, wallet } from "./testnet-wallets.mjs";

const w = wallet("PROVIDER");
for (const [to, amount] of [[get("EVALUATOR_ADDRESS"), "5"], [get("BUYER_ADDRESS"), "8"]]) {
  const hash = await w.sendTransaction({ to, value: parseEther(amount) });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(to, amount, r.status, `https://testnet.arcscan.app/tx/${hash}`);
}
