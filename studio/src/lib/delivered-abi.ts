// ABI for Delivered.sol — keep in sync with contracts/Delivered.sol
export const DELIVERED_ABI = [
  // ── Provider setup ────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'setDeliverySigner',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newSigner', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'registerProvider',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'payoutAddress', type: 'address' },
    ],
    outputs: [],
  },
  // ── Job creation ──────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'createAndFundJob',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' },
      { name: 'expiry', type: 'uint64' },
      { name: 'requestHash', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  // ── Delivery ──────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'submitWithSignature',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
      { name: 'deliveredAt', type: 'uint64' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  // ── Evaluation ────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'complete',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'reasonHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reject',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'reasonHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  // ── Automatic refund ──────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'claimRefund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  // ── Views ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'getProviderStats',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        name: 'stats',
        type: 'tuple',
        components: [
          { name: 'jobsCompleted', type: 'uint64' },
          { name: 'jobsRejected', type: 'uint64' },
          { name: 'jobsFailedAdmitted', type: 'uint64' },
          { name: 'jobsExpired', type: 'uint64' },
          { name: 'jobsEvaluatorTimeout', type: 'uint64' },
          { name: 'usdcEarned', type: 'uint128' },
        ],
      },
      { name: 'score', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'jobs',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'client', type: 'address' },
      { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' },
      { name: 'payoutAddress', type: 'address' },
      { name: 'requestHash', type: 'bytes32' },
      { name: 'deliveryResponseHash', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'submittedAt', type: 'uint64' },
      { name: 'deliveryStatus', type: 'uint8' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'providerInfo',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'payoutAddress', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'nextJobId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'reputationRegistry',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'evaluator', type: 'address', indexed: false },
      { name: 'requestHash', type: 'bytes32', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'expiry', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Funded',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DeliverySubmitted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'responseHash', type: 'bytes32', indexed: false },
      { name: 'deliveryStatus', type: 'uint8', indexed: false },
      { name: 'deliveredAt', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobCompleted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'evaluator', type: 'address', indexed: true },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
      { name: 'payoutAddress', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobRejected',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'evaluator', type: 'address', indexed: true },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Refunded',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ScoreUpdated',
    inputs: [
      { name: 'provider', type: 'address', indexed: true },
      { name: 'jobsCompleted', type: 'uint64', indexed: false },
      { name: 'jobsRejected', type: 'uint64', indexed: false },
      { name: 'jobsFailedAdmitted', type: 'uint64', indexed: false },
      { name: 'jobsExpired', type: 'uint64', indexed: false },
      { name: 'jobsEvaluatorTimeout', type: 'uint64', indexed: false },
      { name: 'score', type: 'uint8', indexed: false },
    ],
  },
] as const
