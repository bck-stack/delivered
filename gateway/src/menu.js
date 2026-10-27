// The checks this provider sells through Delivered. Prices are USDC with 6 decimals (10000 = $0.01).
// clean() keeps only the known inputs, as strings, so the buyer and the gateway hash the same request.
const PRICE = "10000";
const addr = (v) => /^0x[0-9a-fA-F]{40}$/.test(String(v ?? "").trim());
const pick = (keys, required = []) => (input) => {
  const out = {};
  for (const k of keys) if (input[k] !== undefined && String(input[k]).trim() !== "") out[k] = String(input[k]).trim();
  for (const k of required) if (!out[k]) return { error: `missing input "${k}"` };
  return out;
};
const withAddress = (keys) => (input) => {
  const out = pick(keys, ["address"])(input);
  if (out.error) return out;
  return addr(out.address) ? out : { error: "address must be a 0x contract address" };
};

export const MENU = {
  "smart-contract-verify": { title: "Contract source check", about: "Is the contract's source code verified, and which compiler and license does it use?", price: PRICE, inputs: ["address", "chainId"], example: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", chainId: "1" }, clean: withAddress(["address", "chainId"]) },
  "honeypot-detector": { title: "Honeypot check", about: "Can this token be sold after it is bought? Buy and sell tax, transfer limits and owner controls.", price: PRICE, inputs: ["address", "chainId"], example: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", chainId: "1" }, clean: withAddress(["address", "chainId"]) },
  "token-holder-concentration": { title: "Holder concentration", about: "How much of the supply sits with the largest holders.", price: PRICE, inputs: ["address"], example: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA" }, clean: withAddress(["address"]) },
  "dex-pool-liquidity": { title: "Pool liquidity", about: "Liquidity, volume and price of a DEX pool before an agent trades through it.", price: PRICE, inputs: ["chain", "pool"], example: { chain: "ethereum", pool: "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36" }, clean: pick(["chain", "pool"], ["chain", "pool"]) },
  "defillama-tvl-oracle": { title: "Protocol TVL", about: "Total value locked in a DeFi protocol right now.", price: PRICE, inputs: ["protocol"], example: { protocol: "aave" }, clean: pick(["protocol"], ["protocol"]) },
  "defillama-stablecoins": { title: "Stablecoin supply and peg", about: "Circulating supply and peg of the major stablecoins.", price: PRICE, inputs: ["symbols"], example: { symbols: "USDC,USDT" }, clean: pick(["symbols"]) },
  "aave-lending-markets": { title: "Aave lending rates", about: "Supply and borrow rates and utilisation on Aave.", price: PRICE, inputs: ["symbol"], example: { symbol: "USDC" }, clean: pick(["symbol"]) },
  "whale-alert-transfers": { title: "Large transfers", about: "The largest recent Bitcoin transfers.", price: PRICE, inputs: ["minBtc", "limit"], example: { minBtc: "100", limit: "5" }, clean: pick(["minBtc", "limit"]) },
};

// The exact text whose keccak256 is the job's requestHash: ["<check id>", {inputs sorted by name}].
export function requestString(tool, input) {
  return JSON.stringify([tool, Object.fromEntries(Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))]);
}
