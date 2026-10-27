// Delivered provider gateway: sells a small menu of on-chain risk checks against a funded Delivered job on Arc.
// The buyer funds the job first; the gateway reads it from the chain, runs the check, and returns the result with an
// EIP-712 delivery receipt. Anyone can post that receipt to the contract. The signing key signs receipts only and
// holds no funds.
import { createPublicClient, http, keccak256, toBytes, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MENU, requestString } from "./menu.js";

const ABI = [{
  type: "function", name: "jobs", stateMutability: "view", inputs: [{ name: "", type: "uint256" }],
  outputs: [
    { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" },
    { name: "evaluator", type: "address" }, { name: "payoutAddress", type: "address" }, { name: "requestHash", type: "bytes32" },
    { name: "deliveryResponseHash", type: "bytes32" }, { name: "amount", type: "uint256" }, { name: "expiry", type: "uint64" },
    { name: "submittedAt", type: "uint64" }, { name: "deliveryStatus", type: "uint8" }, { name: "status", type: "uint8" },
  ],
}];
const FUNDED = 1;
const RECEIPT_TYPES = {
  DeliveryReceipt: [
    { name: "jobId", type: "uint256" }, { name: "requestHash", type: "bytes32" }, { name: "responseHash", type: "bytes32" },
    { name: "status", type: "uint8" }, { name: "deliveredAt", type: "uint64" },
  ],
};

const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (body, status = 200) => new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), { status, headers: { "content-type": "application/json", ...cors } });

function chainOf(env) {
  const id = Number(env.CHAIN_ID);
  return defineChain({ id, name: id === 5042 ? "Arc" : "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [env.RPC_URL] } } });
}

export function hashRequest(tool, input) {
  return keccak256(toBytes(requestString(tool, input)));
}

async function runCheck(env, tool, input) {
  const url = `https://api/selftest?key=${encodeURIComponent(env.TOOLS_KEY)}&t=${encodeURIComponent(tool)}&p=${encodeURIComponent(JSON.stringify(input))}&full=1`;
  const res = await env.TOOLS.fetch(url, { signal: AbortSignal.timeout(25000) });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return body.ok ? { ok: true, result: body.result } : { ok: false, error: String(body.error || "check failed").slice(0, 300) };
}

async function deliver(env, body) {
  const tool = String(body?.tool ?? "");
  const item = MENU[tool];
  if (!item) return json({ error: `unknown check "${tool}"` }, 400);
  const input = item.clean(body?.input ?? {});
  if (input.error) return json({ error: input.error }, 400);
  let jobId;
  try { jobId = BigInt(body?.jobId); } catch { return json({ error: "jobId must be a number" }, 400); }

  // One delivery per job: a repeated call returns the stored one.
  const stored = await env.RECEIPTS.get(`job:${jobId}`);
  if (stored) return json(JSON.parse(stored));

  const client = createPublicClient({ chain: chainOf(env), transport: http(env.RPC_URL) });
  const job = await client.readContract({ address: env.CONTRACT, abi: ABI, functionName: "jobs", args: [jobId] });
  const [id, buyer, provider, , , requestHash, , amount, expiry, , , status] = job;
  if (id === 0n) return json({ error: "no such job" }, 404);
  if (provider.toLowerCase() !== env.PROVIDER.toLowerCase()) return json({ error: "this job names another provider" }, 409);
  if (Number(status) !== FUNDED) return json({ error: "job is not in the funded state" }, 409);
  if (Number(expiry) <= Math.floor(Date.now() / 1000) + 30) return json({ error: "job expires too soon to deliver" }, 409);
  if (amount < BigInt(item.price)) return json({ error: `job pays ${amount} but this check costs ${item.price} (USDC, 6 decimals)` }, 402);
  if (requestHash.toLowerCase() !== hashRequest(tool, input).toLowerCase()) return json({ error: "requestHash does not match this check and input" }, 409);

  const out = await runCheck(env, tool, input);
  const response = out.ok ? out.result : { error: out.error };
  const responseHash = keccak256(toBytes(JSON.stringify(response)));
  // The chain's clock can trail ours by a few seconds; the contract refuses a receipt dated in its future.
  const receipt = { jobId, requestHash, responseHash, status: out.ok ? 0 : 1, deliveredAt: BigInt(Math.floor(Date.now() / 1000) - 30) };
  const signer = privateKeyToAccount(env.DELIVERY_SIGNER_KEY);
  const signature = await signer.signTypedData({
    domain: { name: "Delivered", version: "1", chainId: Number(env.CHAIN_ID), verifyingContract: env.CONTRACT },
    types: RECEIPT_TYPES, primaryType: "DeliveryReceipt", message: receipt,
  });
  const record = { jobId, tool, input, buyer, delivered: out.ok, response, receipt, signature, signer: signer.address };
  await env.RECEIPTS.put(`job:${jobId}`, JSON.stringify(record, (_, v) => (typeof v === "bigint" ? v.toString() : v)), { expirationTtl: 90 * 86400 });
  return json(record);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, service: "Delivered provider gateway", chainId: Number(env.CHAIN_ID), contract: env.CONTRACT, provider: env.PROVIDER, signer: privateKeyToAccount(env.DELIVERY_SIGNER_KEY).address });
      }
      if (url.pathname === "/menu") {
        return json({ provider: env.PROVIDER, contract: env.CONTRACT, chainId: Number(env.CHAIN_ID), currency: "USDC (6 decimals)", checks: Object.entries(MENU).map(([id, m]) => ({ id, title: m.title, about: m.about, price: m.price, inputs: m.inputs, example: m.example })) });
      }
      if (url.pathname === "/request-hash" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const item = MENU[body?.tool];
        if (!item) return json({ error: "unknown check" }, 400);
        const input = item.clean(body.input ?? {});
        if (input.error) return json({ error: input.error }, 400);
        return json({ tool: body.tool, input, requestString: requestString(body.tool, input), requestHash: hashRequest(body.tool, input) });
      }
      if (url.pathname === "/deliver" && req.method === "POST") return await deliver(env, await req.json().catch(() => null));
      const m = /^\/delivery\/(\d+)$/.exec(url.pathname);
      if (m) {
        const stored = await env.RECEIPTS.get(`job:${m[1]}`);
        return stored ? json(JSON.parse(stored)) : json({ error: "no delivery for this job yet" }, 404);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error("gateway:", e?.message || e);
      return json({ error: "gateway error, nothing was delivered or signed", detail: String(e?.shortMessage || e?.message || e).slice(0, 200) }, 503);
    }
  },
};
