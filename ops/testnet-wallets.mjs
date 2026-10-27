// Testnet helper: reads the three Delivered testnet wallets and exposes viem clients for them.
import { readFileSync } from "node:fs";
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = readFileSync("C:/Users/mandi/Desktop/projeler/tekleme işler/.env.delivered-testnet", "utf8");
export const get = (k) => env.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
export const chain = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } } });
export const pub = createPublicClient({ chain, transport: http() });
export const wallet = (role) => createWalletClient({ account: privateKeyToAccount(get(`${role}_KEY`)), chain, transport: http() });
