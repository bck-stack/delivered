// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DeliveredTestBase} from "./Delivered.Base.t.sol";
import {Delivered} from "../Delivered.sol";
import {MockReputationRegistry, MockRevertingRegistry} from "../test-helpers/MockReputationRegistry.sol";

/// Tests 17-19, 22: score computation, usdcEarned, events, signer rotation.
contract DeliveredEventsStatsTest is DeliveredTestBase {

    function _jobStatus(uint256 jobId) internal view returns (Delivered.JobStatus) {
        (,,,,,,,,,,,Delivered.JobStatus s) = delivered.jobs(jobId);
        return s;
    }

    // ── Test 17: Score = 3*100 / (3+1+1) = 60; jobsFailedAdmitted not in denom
    function test_ScoreComputation_3Completed_1Rejected_1Expired() public {
        usdc.mint(clientAddr, 5 * AMOUNT);

        // ── 3 completed jobs ──────────────────────────────────────────────
        for (uint256 i = 0; i < 3; i++) {
            uint64 expiry = uint64(block.timestamp + 1 hours);
            vm.prank(clientAddr);
            uint256 jobId = delivered.createAndFundJob(
                providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
            );
            bytes32 rHash = keccak256(abi.encodePacked("resp", i));
            uint64 deliveredAt = uint64(block.timestamp);
            bytes memory sig = _sign(jobId, REQUEST_HASH, rHash, 0, deliveredAt, deliverySignerKey);
            vm.prank(relayerAddr);
            delivered.submitWithSignature(jobId, rHash, 0, deliveredAt, sig);
            vm.prank(evaluatorAddr);
            delivered.complete(jobId, bytes32(0));
        }

        // ── 1 rejected job ────────────────────────────────────────────────
        {
            uint64 expiry = uint64(block.timestamp + 1 hours);
            vm.prank(clientAddr);
            uint256 jobId = delivered.createAndFundJob(
                providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
            );
            bytes32 rHash = keccak256("resp-rej");
            uint64 deliveredAt = uint64(block.timestamp);
            bytes memory sig = _sign(jobId, REQUEST_HASH, rHash, 0, deliveredAt, deliverySignerKey);
            vm.prank(relayerAddr);
            delivered.submitWithSignature(jobId, rHash, 0, deliveredAt, sig);
            vm.prank(evaluatorAddr);
            delivered.reject(jobId, bytes32(0));
        }

        // ── 1 expired job ─────────────────────────────────────────────────
        {
            uint64 expiry = uint64(block.timestamp + 1 hours);
            vm.prank(clientAddr);
            uint256 jobId = delivered.createAndFundJob(
                providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
            );
            vm.warp(block.timestamp + 2 hours);
            delivered.claimRefund(jobId);
        }

        (Delivered.ProviderStats memory stats, uint8 score) = delivered.getProviderStats(providerAddr);
        assertEq(stats.jobsCompleted, 3);
        assertEq(stats.jobsRejected, 1);
        assertEq(stats.jobsExpired, 1);
        assertEq(stats.jobsFailedAdmitted, 0);
        assertEq(score, 60); // 3*100/(3+1+1)
    }

    // ── Test 18: usdcEarned accumulates across multiple completions ─────────
    function test_UsdcEarned_AccumulatesAcrossMultipleCompletions() public {
        uint256 N = 3;
        usdc.mint(clientAddr, N * AMOUNT);

        for (uint256 i = 0; i < N; i++) {
            uint64 expiry = uint64(block.timestamp + 1 hours);
            vm.prank(clientAddr);
            uint256 jobId = delivered.createAndFundJob(
                providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
            );
            bytes32 rHash = keccak256(abi.encodePacked("r", i));
            uint64 deliveredAt = uint64(block.timestamp);
            bytes memory sig = _sign(jobId, REQUEST_HASH, rHash, 0, deliveredAt, deliverySignerKey);
            vm.prank(relayerAddr);
            delivered.submitWithSignature(jobId, rHash, 0, deliveredAt, sig);
            vm.prank(evaluatorAddr);
            delivered.complete(jobId, bytes32(0));
        }

        (Delivered.ProviderStats memory stats,) = delivered.getProviderStats(providerAddr);
        assertEq(stats.usdcEarned, N * AMOUNT);
        assertEq(usdc.balanceOf(payoutAddr), N * AMOUNT);
    }

    // ── Test 19a: JobCreated + Funded + DeliverySubmitted + JobCompleted + ScoreUpdated
    function test_Events_JobCreated_Funded_Submitted_Completed() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);

        // JobCreated + Funded
        vm.expectEmit(true, true, true, true, address(delivered));
        emit Delivered.JobCreated(1, clientAddr, providerAddr, evaluatorAddr, REQUEST_HASH, AMOUNT, expiry);
        vm.expectEmit(true, true, false, true, address(delivered));
        emit Delivered.Funded(1, clientAddr, AMOUNT);
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        // DeliverySubmitted
        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, deliverySignerKey);
        vm.expectEmit(true, false, false, true, address(delivered));
        emit Delivered.DeliverySubmitted(jobId, RESPONSE_HASH, 0, deliveredAt);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, sig);

        // JobCompleted + ScoreUpdated (7 args: provider, completed, rejected, failedAdmitted, expired, evaluatorTimeout, score)
        bytes32 reasonHash = keccak256("reason");
        vm.expectEmit(true, true, false, true, address(delivered));
        emit Delivered.JobCompleted(jobId, evaluatorAddr, reasonHash, payoutAddr, AMOUNT);
        vm.expectEmit(true, false, false, true, address(delivered));
        emit Delivered.ScoreUpdated(providerAddr, 1, 0, 0, 0, 0, 100);
        vm.prank(evaluatorAddr);
        delivered.complete(jobId, reasonHash);
    }

    // ── Test 19b: JobRejected + Refunded + ScoreUpdated
    function test_Events_JobRejected_Refunded_ScoreUpdated() public {
        uint256 jobId = _createAndFundJob();
        _submitDelivered(jobId);

        bytes32 reasonHash = keccak256("rejected");
        vm.expectEmit(true, true, false, true, address(delivered));
        emit Delivered.JobRejected(jobId, evaluatorAddr, reasonHash);
        vm.expectEmit(true, true, false, true, address(delivered));
        emit Delivered.Refunded(jobId, clientAddr, AMOUNT);
        vm.expectEmit(true, false, false, true, address(delivered));
        emit Delivered.ScoreUpdated(providerAddr, 0, 1, 0, 0, 0, 0);
        vm.prank(evaluatorAddr);
        delivered.reject(jobId, reasonHash);
    }

    // ── Test 19c: Refunded event on expiry
    function test_Events_Refunded_OnExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        vm.warp(block.timestamp + 2 hours);

        vm.expectEmit(true, true, false, true, address(delivered));
        emit Delivered.Refunded(jobId, clientAddr, AMOUNT);
        delivered.claimRefund(jobId);
    }

    // ── Test 22: Signer rotation ───────────────────────────────────────────
    function test_SignerRotation_OldSigFails_NewSigSucceeds() public {
        uint256 jobId = _createAndFundJob();

        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory oldSig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, deliverySignerKey);

        // Provider rotates to a new signer
        uint256 newSignerKey = 0xBEEF1234;
        address newSigner = vm.addr(newSignerKey);
        vm.prank(providerAddr);
        delivered.setDeliverySigner(newSigner);

        // Old sig is now invalid
        vm.expectRevert(Delivered.InvalidSignature.selector);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, oldSig);

        // New sig from new signer succeeds
        bytes memory newSig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, newSignerKey);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, newSig);

        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Submitted));
    }

    // ── T-E: ScoreUpdated on evaluator-timeout claimRefund carries jobsEvaluatorTimeout ──
    function test_Events_ScoreUpdated_EvaluatorTimeout_Field() public {
        uint256 jobId = _createAndFundJob();
        _submitDelivered(jobId);
        vm.warp(block.timestamp + 24 hours + 1);

        // Refunded + ScoreUpdated — evaluatorTimeout=1, score=50 (denom=0)
        vm.expectEmit(true, true, false, true, address(delivered));
        emit Delivered.Refunded(jobId, clientAddr, AMOUNT);
        vm.expectEmit(true, false, false, true, address(delivered));
        emit Delivered.ScoreUpdated(providerAddr, 0, 0, 0, 0, 1, 50);
        delivered.claimRefund(jobId);
    }

    // ── Helper: sign a delivery receipt for an arbitrary Delivered contract ──
    function _signForContract(
        address contractAddr,
        uint256 jobId,
        bytes32 responseHash,
        uint8   status,
        uint64  deliveredAt
    ) internal view returns (bytes memory) {
        bytes32 domSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("Delivered")),
            keccak256(bytes("1")),
            block.chainid,
            contractAddr
        ));
        bytes32 structHash = keccak256(abi.encode(
            DELIVERY_RECEIPT_TYPEHASH, jobId, REQUEST_HASH, responseHash, status, deliveredAt
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(deliverySignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── Helper: fund, submit (delivered), and return jobId for a given Delivered ──
    function _fundAndSubmit(Delivered d) internal returns (uint256 jobId) {
        usdc.mint(clientAddr, AMOUNT);
        vm.prank(clientAddr);
        usdc.approve(address(d), type(uint256).max);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        jobId = d.createAndFundJob(providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT);
        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _signForContract(address(d), jobId, RESPONSE_HASH, 0, deliveredAt);
        vm.prank(relayerAddr);
        d.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, sig);
    }

    // ── T-C: reputationRegistry = address(0) → all outcomes succeed, no reputation events ──
    function test_ReputationDisabled_ZeroAddress_Complete() public {
        Delivered noReg = new Delivered(address(0));
        vm.prank(providerAddr); noReg.setDeliverySigner(deliverySignerAddr);
        vm.prank(providerAddr); noReg.registerProvider(1, payoutAddr);

        uint256 jobId = _fundAndSubmit(noReg);
        vm.prank(evaluatorAddr);
        noReg.complete(jobId, bytes32(0));

        assertEq(usdc.balanceOf(payoutAddr), AMOUNT);
        (Delivered.ProviderStats memory stats,) = noReg.getProviderStats(providerAddr);
        assertEq(stats.jobsCompleted, 1);
    }

    function test_ReputationDisabled_ZeroAddress_Reject() public {
        Delivered noReg = new Delivered(address(0));
        vm.prank(providerAddr); noReg.setDeliverySigner(deliverySignerAddr);
        vm.prank(providerAddr); noReg.registerProvider(1, payoutAddr);

        uint256 jobId = _fundAndSubmit(noReg);
        vm.prank(evaluatorAddr);
        noReg.reject(jobId, bytes32(0));

        (Delivered.ProviderStats memory stats,) = noReg.getProviderStats(providerAddr);
        assertEq(stats.jobsRejected, 1);
    }

    function test_ReputationDisabled_ZeroAddress_ClaimRefund() public {
        Delivered noReg = new Delivered(address(0));
        vm.prank(providerAddr); noReg.setDeliverySigner(deliverySignerAddr);
        vm.prank(providerAddr); noReg.registerProvider(1, payoutAddr);

        usdc.mint(clientAddr, AMOUNT);
        vm.prank(clientAddr);
        usdc.approve(address(noReg), type(uint256).max);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = noReg.createAndFundJob(providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT);
        vm.warp(block.timestamp + 2 hours);
        noReg.claimRefund(jobId);

        (Delivered.ProviderStats memory stats,) = noReg.getProviderStats(providerAddr);
        assertEq(stats.jobsExpired, 1);
    }

    // ── T-D: Reverting registry → ReputationWriteFailed emitted; tx still succeeds ──
    function _setupBadReg() internal returns (Delivered badReg) {
        MockRevertingRegistry revertReg = new MockRevertingRegistry();
        vm.etch(REP_REGISTRY, address(revertReg).code);
        badReg = new Delivered(REP_REGISTRY);
        vm.prank(providerAddr); badReg.setDeliverySigner(deliverySignerAddr);
        vm.prank(providerAddr); badReg.registerProvider(42, payoutAddr);
    }

    function test_RevertingRegistry_Complete_EmitsWriteFailed() public {
        Delivered badReg = _setupBadReg();

        uint256 jobId = _fundAndSubmit(badReg);

        vm.expectEmit(true, false, false, true, address(badReg));
        emit Delivered.ReputationWriteFailed(providerAddr, 42, "completed");
        vm.prank(evaluatorAddr);
        badReg.complete(jobId, bytes32(0));

        assertEq(usdc.balanceOf(payoutAddr), AMOUNT);
    }

    function test_RevertingRegistry_Reject_EmitsWriteFailed() public {
        Delivered badReg = _setupBadReg();

        uint256 jobId = _fundAndSubmit(badReg);

        vm.expectEmit(true, false, false, true, address(badReg));
        emit Delivered.ReputationWriteFailed(providerAddr, 42, "rejected");
        vm.prank(evaluatorAddr);
        badReg.reject(jobId, bytes32(0));
    }

    function test_RevertingRegistry_ClaimRefund_EmitsWriteFailed() public {
        Delivered badReg = _setupBadReg();

        usdc.mint(clientAddr, AMOUNT);
        vm.prank(clientAddr);
        usdc.approve(address(badReg), type(uint256).max);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = badReg.createAndFundJob(providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT);
        vm.warp(block.timestamp + 2 hours);

        vm.expectEmit(true, false, false, true, address(badReg));
        emit Delivered.ReputationWriteFailed(providerAddr, 42, "expired");
        badReg.claimRefund(jobId);
    }
}
