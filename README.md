# Delivered

Agents pay for API calls only when the result arrives.

An agent locks the price of one API call in USDC on Arc. The provider answers with the result and a delivery receipt signed by its delivery key. An independent evaluator checks the result against the receipt and the original request, then releases the money to the provider or sends it back. Every outcome updates the provider's score on chain and in its ERC-8004 reputation, so the next agent can check the provider before it pays.

- App: https://delivered-app.chainmarket-api.workers.dev
- Built in Arc Studio: https://studio.arc.io/app/f90f5b28-ee69-4c8f-b22e-8296a7592924
- Demo video (Arc mainnet purchase): https://youtu.be/y1jyaNtAaDQ
- Nemotron review video: https://youtu.be/QsXmOdVVvAU

## What happens to the money

| Case | Result |
|---|---|
| Delivered and confirmed by the evaluator | Provider is paid, score goes up |
| Provider reports the call failed | Buyer takes a refund at once |
| Nothing delivered before the deadline | Buyer takes a refund, provider's score goes down |
| Evaluator rejects the delivery | Buyer is refunded, provider's score goes down |
| Evaluator silent for 24 hours | Buyer takes a refund, the provider is not blamed |

No fees, no admin keys, no upgradeable proxy.

## Nemotron review

The evaluator's rule checks prove a receipt is genuine: right job, right request, the exact response the provider signed. They cannot tell whether that response actually answers the request. With a Nebius Token Factory key set, the evaluator also sends the check, its input and the response to NVIDIA Nemotron (`nvidia/nemotron-3-super-120b-a12b` by default) and asks for a pass or fail with a one-sentence reason. A fail rejects the job and refunds the buyer; the reason is hashed on chain with the decision and shown in the app's ledger. If the model cannot be reached, the rule checks decide alone, so an outage never holds a provider's payment.

It is on in the live evaluator. The first job it judged on Arc mainnet is job #2 (token holder concentration): Nemotron passed it with "Provides the largest token holders and their percentage share of supply", and the evaluator completed the job 24 seconds after the receipt was posted ([tx](https://explorer.arc.io/tx/0xbc8634923a2d5109aa6a8b0cb36b0093e8e0bdaa497a4f1f809ea7534417023f)).

Code: `studio/evaluator/judge.ts`. Turn it on with `wrangler secret put NEBIUS_API_KEY` (Worker) or `NEBIUS_API_KEY=… npx tsx evaluator/run-once.ts` (Node). `NEMOTRON_MODEL` picks another model.

## Repository

| Folder | What it is |
|---|---|
| `studio/contracts` | The `Delivered` contract and its Foundry tests (32) |
| `studio/src` | The web app: buy a check, provider score, public ledger |
| `studio/evaluator` | The evaluator agent (Cloudflare Worker with a one-minute cron, or a Node script) |
| `studio/scripts` | Provider setup and an end-to-end run against a live network |
| `gateway` | The demo provider: sells eight on-chain risk checks against funded jobs and signs delivery receipts |
| `ops` | Launch and testnet helper scripts |

The contract, app, evaluator and scripts were written and tested in Arc Studio; the gateway is the provider's own service.

## Contracts

| Network | Delivered |
|---|---|
| Arc Testnet | `0x72d179ba5fedf0e6f24c0030afe66d21b5de9904` |
| Arc | `0x6f721eb4f16a972e9d77e4a57fd5324e513476a9` |

Demo provider on Arc: `0xC0cdb5D59CfB277d572A97672AA35910ecDC8c10`, ERC-8004 identity #2789. First paid job: [0x5b3aa04d…](https://explorer.arc.io/tx/0x5b3aa04db680338b190560f0f9c85f13a2ed20d4249496225dd50f8620b5fd1a).

Testnet demo provider: `0x62E057f10DA86da124b8D22dE8eB464210105481`, ERC-8004 identity #897606.

## Delivery receipt

EIP-712, domain `Delivered` / `1`:

```
DeliveryReceipt(uint256 jobId, bytes32 requestHash, bytes32 responseHash, uint8 status, uint64 deliveredAt)
```

`requestHash` is `keccak256` of `JSON.stringify([checkId, inputWithKeysSorted])`, set by the buyer when the job is funded. `responseHash` is `keccak256` of the exact JSON the provider returned. `status` is 0 for delivered, 1 for a failure the provider admits.

## License

MIT
