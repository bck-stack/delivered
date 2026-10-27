// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DeliveredTestBase} from "./Delivered.Base.t.sol";
import {Delivered} from "../Delivered.sol";

contract DeliveredRevertTest is DeliveredTestBase {

    // ── Helpers ────────────────────────────────────────────────────────────

    function _jobStatus(uint256 jobId) internal view returns (Delivered.JobStatus) {
        (,,,,,,,,,,,Delivered.JobStatus s) = delivered.jobs(jobId);
        return s;
    }

    // ── Test 7: Wrong signer → reverts InvalidSignature ───────────────────
    function test_Revert_WrongSigner_InvalidSignature() public {
        uint256 jobId = _createAndFundJob();

        uint64 deliveredAt = uint64(block.timestamp);
        uint256 wrongKey = 0xBAD5;
        bytes memory badSig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, wrongKey);

        vm.expectRevert(Delivered.InvalidSignature.selector);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, badSig);
    }

    // ── Test 8: Replayed receipt → reverts SignatureAlreadyUsed ───────────
    // The contract stores keccak256(signature) → so the SAME bytes revert on any job.
    function test_Revert_ReplayedSignature_SignatureAlreadyUsed() public {
        uint256 jobId = _createAndFundJob();

        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, deliverySignerKey);

        // First use succeeds
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, sig);

        // Complete so we can create a second job
        vm.prank(evaluatorAddr);
        delivered.complete(jobId, bytes32(0));

        // Fund the second job
        usdc.mint(clientAddr, AMOUNT);
        uint64 expiry2 = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId2 = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry2, REQUEST_HASH, AMOUNT
        );

        // Attempt to replay the old signature on the new job
        vm.expectRevert(Delivered.SignatureAlreadyUsed.selector);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId2, RESPONSE_HASH, 0, deliveredAt, sig);
    }

    // ── Test 9: Wrong requestHash in sig → reverts InvalidSignature ────────
    function test_Revert_WrongRequestHash_InvalidSignature() public {
        uint256 jobId = _createAndFundJob();

        bytes32 wrongReqHash = keccak256("completely-different-request");
        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _sign(jobId, wrongReqHash, RESPONSE_HASH, 0, deliveredAt, deliverySignerKey);

        vm.expectRevert(Delivered.InvalidSignature.selector);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, sig);
    }

    // ── Test 10: Double payout → reverts InvalidJobState ──────────────────
    function test_Revert_DoublePayout_InvalidJobState() public {
        uint256 jobId = _createAndFundJob();
        _submitDelivered(jobId);

        vm.prank(evaluatorAddr);
        delivered.complete(jobId, bytes32(0));

        vm.expectRevert(Delivered.InvalidJobState.selector);
        vm.prank(evaluatorAddr);
        delivered.complete(jobId, bytes32(0));
    }

    // ── Test 11: Double refund → reverts RefundNotAvailable ───────────────
    function test_Revert_DoubleRefund_RefundNotAvailable() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        vm.warp(block.timestamp + 2 hours);
        delivered.claimRefund(jobId);

        // Job is now Expired — none of the refund conditions hold
        vm.expectRevert(Delivered.RefundNotAvailable.selector);
        delivered.claimRefund(jobId);
    }

    // ── Test 12: Non-evaluator calls complete → reverts NotJobEvaluator ────
    function test_Revert_NonEvaluator_Complete() public {
        uint256 jobId = _createAndFundJob();
        _submitDelivered(jobId);

        vm.prank(clientAddr);
        vm.expectRevert(Delivered.NotJobEvaluator.selector);
        delivered.complete(jobId, bytes32(0));
    }

    // ── Test 13: Non-evaluator calls reject → reverts NotJobEvaluator ──────
    function test_Revert_NonEvaluator_Reject() public {
        uint256 jobId = _createAndFundJob();
        _submitDelivered(jobId);

        vm.prank(clientAddr);
        vm.expectRevert(Delivered.NotJobEvaluator.selector);
        delivered.reject(jobId, bytes32(0));
    }

    // ── Test 14: submit() by wrong address → reverts NotDeliverySigner ─────
    function test_Revert_Submit_WrongCaller_NotDeliverySigner() public {
        uint256 jobId = _createAndFundJob();

        vm.prank(clientAddr);
        vm.expectRevert(Delivered.NotDeliverySigner.selector);
        delivered.submit(jobId, RESPONSE_HASH);
    }

    // ── Test 15: submitWithSignature after expiry → reverts JobExpired ──────
    function test_Revert_SubmitWithSignature_AfterExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        vm.warp(block.timestamp + 2 hours);

        uint64 deliveredAt = uint64(block.timestamp - 1);
        bytes memory sig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, deliverySignerKey);

        vm.expectRevert(Delivered.JobExpired.selector);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, sig);
    }

    // ── Test 16: complete when deliveryStatus=1 → reverts InvalidJobState ──
    function test_Revert_Complete_AdmittedFailure_InvalidJobState() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 1, deliveredAt, deliverySignerKey);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 1, deliveredAt, sig);

        vm.prank(evaluatorAddr);
        vm.expectRevert(Delivered.InvalidJobState.selector);
        delivered.complete(jobId, bytes32(0));
    }

    // ── Test 20: No deliverySigner → reverts SignerNotConfigured ───────────
    function test_Revert_NoDeliverySigner_SignerNotConfigured() public {
        address newProvider = makeAddr("newProviderA");
        vm.prank(newProvider);
        delivered.registerProvider(1, makeAddr("newPayoutA"));

        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        vm.expectRevert(Delivered.SignerNotConfigured.selector);
        delivered.createAndFundJob(newProvider, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT);
    }

    // ── Test 21: No registered payoutAddress → reverts ZeroAddress ─────────
    function test_Revert_NoRegisteredPayout_ZeroAddress() public {
        address newProvider = makeAddr("newProviderB");
        vm.prank(newProvider);
        delivered.setDeliverySigner(deliverySignerAddr);
        // Do NOT registerProvider — payoutAddress remains address(0)

        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        vm.expectRevert(Delivered.ZeroAddress.selector);
        delivered.createAndFundJob(newProvider, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT);
    }
}
