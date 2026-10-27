import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes, encodeFunctionResult, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import worker, { hashRequest } from "../src/worker.js";

const KEY = generatePrivateKey();
const SIGNER = privateKeyToAccount(KEY).address;
const PROVIDER = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x2222222222222222222222222222222222222222";
const JOBS_ABI = [{ type: "function", name: "jobs", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
  { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" },
  { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "uint64" }, { type: "uint8" }, { type: "uint8" }] }];
const INPUT = { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", chainId: "1" };

function env({ job, tool = { ok: true, result: { verdict: "ok" } } } = {}) {
  const kv = new Map();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const data = encodeFunctionResult({ abi: JOBS_ABI, functionName: "jobs", result: job });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: data }), { headers: { "content-type": "application/json" } });
  };
  return {
    CHAIN_ID: "5042002", RPC_URL: "https://rpc.example", CONTRACT, PROVIDER, DELIVERY_SIGNER_KEY: KEY, TOOLS_KEY: "k",
    RECEIPTS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) },
    TOOLS: { fetch: async () => new Response(JSON.stringify(tool)) },
  };
}
const fundedJob = (over = {}) => {
  const j = { id: 7n, client: "0x3333333333333333333333333333333333333333", provider: PROVIDER, evaluator: "0x4444444444444444444444444444444444444444",
    payout: PROVIDER, requestHash: hashRequest("honeypot-detector", INPUT), response: "0x" + "0".repeat(64), amount: 10000n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 1800), submittedAt: 0n, deliveryStatus: 0, status: 1, ...over };
  return [j.id, j.client, j.provider, j.evaluator, j.payout, j.requestHash, j.response, j.amount, j.expiry, j.submittedAt, j.deliveryStatus, j.status];
};
const deliver = (e, body) => worker.fetch(new Request("https://g/deliver", { method: "POST", body: JSON.stringify(body) }), e);

test("a funded job gets the check result and a receipt signed by the delivery signer", async () => {
  const e = env({ job: fundedJob() });
  const r = await (await deliver(e, { jobId: "7", tool: "honeypot-detector", input: INPUT })).json();
  assert.equal(r.delivered, true);
  assert.deepEqual(r.response, { verdict: "ok" });
  assert.equal(r.receipt.responseHash, keccak256(toBytes(JSON.stringify({ verdict: "ok" }))));
  const m = { ...r.receipt, jobId: BigInt(r.receipt.jobId), deliveredAt: BigInt(r.receipt.deliveredAt) };
  const who = await recoverTypedDataAddress({ domain: { name: "Delivered", version: "1", chainId: 5042002, verifyingContract: CONTRACT },
    types: { DeliveryReceipt: [{ name: "jobId", type: "uint256" }, { name: "requestHash", type: "bytes32" }, { name: "responseHash", type: "bytes32" }, { name: "status", type: "uint8" }, { name: "deliveredAt", type: "uint64" }] },
    primaryType: "DeliveryReceipt", message: m, signature: r.signature });
  assert.equal(who, SIGNER);
  // A second call returns the stored delivery, not a new one.
  const again = await (await deliver(e, { jobId: "7", tool: "honeypot-detector", input: INPUT })).json();
  assert.equal(again.signature, r.signature);
});

test("a failed check is delivered as an admitted failure (status 1) so the buyer can take a refund", async () => {
  const r = await (await deliver(env({ job: fundedJob(), tool: { ok: false, error: "upstream down" } }), { jobId: "7", tool: "honeypot-detector", input: INPUT })).json();
  assert.equal(r.delivered, false);
  assert.equal(r.receipt.status, 1);
});

test("jobs that are not ours, not funded, underpaid or for another request get nothing signed", async () => {
  const cases = [
    [fundedJob({ provider: "0x5555555555555555555555555555555555555555" }), 409],
    [fundedJob({ status: 2 }), 409],
    [fundedJob({ amount: 9999n }), 402],
    [fundedJob({ requestHash: keccak256(toBytes("other")) }), 409],
    [fundedJob({ expiry: BigInt(Math.floor(Date.now() / 1000) + 10) }), 409],
    [fundedJob({ id: 0n }), 404],
  ];
  for (const [job, status] of cases) {
    const res = await deliver(env({ job }), { jobId: "7", tool: "honeypot-detector", input: INPUT });
    assert.equal(res.status, status);
    assert.equal((await res.json()).signature, undefined);
  }
});

test("unknown checks and bad inputs are refused before the chain is read", async () => {
  assert.equal((await deliver(env({ job: fundedJob() }), { jobId: "7", tool: "nope", input: {} })).status, 400);
  assert.equal((await deliver(env({ job: fundedJob() }), { jobId: "7", tool: "honeypot-detector", input: { address: "abc" } })).status, 400);
});

test("the request hash ignores input order and unknown fields", async () => {
  const e = env({ job: fundedJob() });
  const a = await (await worker.fetch(new Request("https://g/request-hash", { method: "POST", body: JSON.stringify({ tool: "honeypot-detector", input: { chainId: "1", address: INPUT.address, extra: "x" } }) }), e)).json();
  assert.equal(a.requestHash, hashRequest("honeypot-detector", INPUT));
});
