// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Delivered} from "../Delivered.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {MockReputationRegistry, MockRevertingRegistry} from "../test-helpers/MockReputationRegistry.sol";

/// @dev Shared base for all Delivered test suites.
abstract contract DeliveredTestBase is Test {
    // ── Canonical hardcoded addresses ──────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    address internal constant REP_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    // ── EIP-712 typehash (matches contract) ────────────────────────────────
    bytes32 internal constant DELIVERY_RECEIPT_TYPEHASH = keccak256(
        "DeliveryReceipt(uint256 jobId,bytes32 requestHash,bytes32 responseHash,uint8 status,uint64 deliveredAt)"
    );

    // ── Actors ─────────────────────────────────────────────────────────────
    address internal clientAddr;
    address internal providerAddr;
    address internal evaluatorAddr;
    address internal relayerAddr;
    address internal payoutAddr;

    // delivery signer has a known private key so we can sign receipts
    uint256 internal deliverySignerKey = 0xA11CE;
    address internal deliverySignerAddr;

    // ── Contracts under test ───────────────────────────────────────────────
    Delivered internal delivered;
    MockERC20  internal usdc;

    // ── Common job params ──────────────────────────────────────────────────
    bytes32 internal constant REQUEST_HASH  = keccak256("job-request-1");
    bytes32 internal constant RESPONSE_HASH = keccak256("job-response-1");
    uint256 internal constant AMOUNT        = 100e6; // 100 USDC (6 decimals)

    // ── setUp ──────────────────────────────────────────────────────────────
    function setUp() public virtual {
        clientAddr        = makeAddr("client");
        providerAddr      = makeAddr("provider");
        evaluatorAddr     = makeAddr("evaluator");
        relayerAddr       = makeAddr("relayer");
        payoutAddr        = makeAddr("payout");
        deliverySignerAddr = vm.addr(deliverySignerKey);

        // 1. Deploy a real MockERC20 and etch its bytecode at the USDC constant.
        MockERC20 mockTemplate = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mockTemplate).code);
        usdc = MockERC20(USDC_ADDR);

        // 2. Deploy a no-op reputation registry stub and etch it at REP_REGISTRY.
        MockReputationRegistry repStub = new MockReputationRegistry();
        vm.etch(REP_REGISTRY, address(repStub).code);

        // 3. Deploy the contract under test — pass REP_REGISTRY as the constructor arg.
        delivered = new Delivered(REP_REGISTRY);

        // 4. Seed client with USDC and approve the contract.
        usdc.mint(clientAddr, 10_000e6);
        vm.prank(clientAddr);
        usdc.approve(address(delivered), type(uint256).max);

        // 5. Standard provider setup (tests that need different state override this).
        vm.prank(providerAddr);
        delivered.setDeliverySigner(deliverySignerAddr);
        vm.prank(providerAddr);
        delivered.registerProvider(1, payoutAddr);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /// Compute the EIP-712 domain separator for the deployed Delivered contract.
    function _domainSeparator() internal view returns (bytes32) {
        // OZ EIP712 v5 uses:
        //   keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
        bytes32 typeHash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        return keccak256(
            abi.encode(
                typeHash,
                keccak256(bytes("Delivered")),
                keccak256(bytes("1")),
                block.chainid,
                address(delivered)
            )
        );
    }

    /// Build the EIP-712 digest that the delivery signer must sign.
    function _buildDigest(
        uint256 jobId,
        bytes32 requestHash,
        bytes32 responseHash,
        uint8   status,
        uint64  deliveredAt
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                DELIVERY_RECEIPT_TYPEHASH,
                jobId,
                requestHash,
                responseHash,
                status,
                deliveredAt
            )
        );
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                structHash
            )
        );
    }

    /// Sign a delivery receipt and return the signature bytes.
    function _sign(
        uint256 jobId,
        bytes32 requestHash,
        bytes32 responseHash,
        uint8   status,
        uint64  deliveredAt,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        bytes32 digest = _buildDigest(jobId, requestHash, responseHash, status, deliveredAt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Create-and-fund a standard job from clientAddr; returns jobId.
    function _createAndFundJob() internal returns (uint256 jobId) {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );
    }

    /// Submit with signature (status=0 = delivered) by relayerAddr.
    function _submitDelivered(uint256 jobId) internal {
        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, deliverySignerKey);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, sig);
    }
}
