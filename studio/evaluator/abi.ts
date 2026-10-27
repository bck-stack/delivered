/** Minimal ABI for the Delivered contract — evaluator only needs these. */
export const DELIVERED_ABI = [
  {
    type: 'function',
    name: 'jobs',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id',                  type: 'uint256' },
      { name: 'client',              type: 'address' },
      { name: 'provider',            type: 'address' },
      { name: 'evaluator',           type: 'address' },
      { name: 'payoutAddress',       type: 'address' },
      { name: 'requestHash',         type: 'bytes32' },
      { name: 'deliveryResponseHash',type: 'bytes32' },
      { name: 'amount',              type: 'uint256' },
      { name: 'expiry',              type: 'uint64'  },
      { name: 'submittedAt',         type: 'uint64'  },
      { name: 'deliveryStatus',      type: 'uint8'   },
      { name: 'status',              type: 'uint8'   },
    ],
  },
  {
    type: 'function',
    name: 'complete',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',     type: 'uint256' },
      { name: 'reasonHash',type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'reject',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',     type: 'uint256' },
      { name: 'reasonHash',type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'DeliverySubmitted',
    inputs: [
      { name: 'jobId',          type: 'uint256', indexed: true  },
      { name: 'responseHash',   type: 'bytes32', indexed: false },
      { name: 'deliveryStatus', type: 'uint8',   indexed: false },
      { name: 'deliveredAt',    type: 'uint64',  indexed: false },
    ],
  },
] as const
