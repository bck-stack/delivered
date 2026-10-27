// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DeliveredTestBase} from "./Delivered.Base.t.sol";
import {Delivered} from "../Delivered.sol";

contract DeliveredHappyPathTest is DeliveredTestBase {

    // ── Helpers: avoid stack-too-deep from 12-field tuple ─────────────────

    /// Return just the JobStatus field of a job.
    function _jobStatus(uint256 jobId) internal view returns (Delivered.JobStatus) {
        (,,,,,,,,,,,Delivered.JobStatus s) = delivered.jobs(jobId);
        return s;
    }

    /// Return just the deliveryStatus (uint8) field of a job.
    function _deliveryStatus(uint256 jobId) internal view returns (uint8) {
        (,,,,,,,,,,uint8 ds,) = delivered.jobs(jobId);
        return ds;
    }

    /// Return just the payoutAddress field of a job.
    function _jobPayout(uint256 jobId) internal view returns (address) {
        (,,,,address p,,,,,,,) = delivered.jobs(jobId);
        return p;
    }

    // ── Test 1: createAndFundJob → submitWithSignature → complete ──────────
    function test_HappyPath_CreateAndFund_SubmitWithSig_Complete() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);

        // createAndFundJob
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        assertEq(jobId, 1);
        assertEq(usdc.balanceOf(address(delivered)), AMOUNT);
        assertEq(usdc.balanceOf(clientAddr), 10_000e6 - AMOUNT);
        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Funded));
        assertEq(_jobPayout(jobId), payoutAddr);

        // submitWithSignature (anyone can relay)
        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 0, deliveredAt, deliverySignerKey);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 0, deliveredAt, sig);

        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Submitted));

        // complete by evaluator
        bytes32 reasonHash = keccak256("looks good");
        vm.prank(evaluatorAddr);
        delivered.complete(jobId, reasonHash);

        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Completed));

        // provider received USDC at payoutAddr
        assertEq(usdc.balanceOf(payoutAddr), AMOUNT);
        assertEq(usdc.balanceOf(address(delivered)), 0);

        // stats updated
        (Delivered.ProviderStats memory stats, uint8 score) = delivered.getProviderStats(providerAddr);
        assertEq(stats.jobsCompleted, 1);
        assertEq(stats.usdcEarned, AMOUNT);
        assertEq(score, 100);
    }

    // ── Test 2: createJob + fundJob → submit (signer sends tx) → complete ──
    function test_HappyPath_CreateJob_FundJob_Submit_Complete() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);

        vm.prank(clientAddr);
        uint256 jobId = delivered.createJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );
        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Created));

        vm.prank(clientAddr);
        delivered.fundJob(jobId);
        assertEq(usdc.balanceOf(address(delivered)), AMOUNT);
        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Funded));

        // submit() — the delivery signer sends the tx directly
        vm.prank(deliverySignerAddr);
        delivered.submit(jobId, RESPONSE_HASH);
        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Submitted));

        vm.prank(evaluatorAddr);
        delivered.complete(jobId, bytes32(0));
        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Completed));

        assertEq(usdc.balanceOf(payoutAddr), AMOUNT);

        (Delivered.ProviderStats memory stats,) = delivered.getProviderStats(providerAddr);
        assertEq(stats.jobsCompleted, 1);
        assertEq(stats.usdcEarned, AMOUNT);
    }

    // ── Test 3: Evaluator reject → client refunded ─────────────────────────
    function test_EvaluatorReject_ClientRefunded() public {
        uint256 jobId = _createAndFundJob();
        _submitDelivered(jobId);

        uint256 clientBefore = usdc.balanceOf(clientAddr);

        vm.prank(evaluatorAddr);
        delivered.reject(jobId, bytes32(0));

        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Rejected));
        assertEq(usdc.balanceOf(clientAddr), clientBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(delivered)), 0);

        (Delivered.ProviderStats memory stats,) = delivered.getProviderStats(providerAddr);
        assertEq(stats.jobsRejected, 1);
    }

    // ── Test 4: Admitted failure → claimRefund → jobsFailedAdmitted++ ──────
    function test_AdmittedFailure_ClaimRefund() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        // Submit with status=1 (admitted failure)
        uint64 deliveredAt = uint64(block.timestamp);
        bytes memory sig = _sign(jobId, REQUEST_HASH, RESPONSE_HASH, 1, deliveredAt, deliverySignerKey);
        vm.prank(relayerAddr);
        delivered.submitWithSignature(jobId, RESPONSE_HASH, 1, deliveredAt, sig);

        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Submitted));
        assertEq(_deliveryStatus(jobId), 1);

        uint256 clientBefore = usdc.balanceOf(clientAddr);
        delivered.claimRefund(jobId);

        assertEq(usdc.balanceOf(clientAddr), clientBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(delivered)), 0);

        (Delivered.ProviderStats memory stats,) = delivered.getProviderStats(providerAddr);
        assertEq(stats.jobsFailedAdmitted, 1);
        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Rejected));
    }

    // ── Test 5: Expiry without submission → claimRefund → jobsExpired++ ────
    function test_ExpiryWithoutSubmission_ClaimRefund() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(clientAddr);
        uint256 jobId = delivered.createAndFundJob(
            providerAddr, evaluatorAddr, expiry, REQUEST_HASH, AMOUNT
        );

        vm.warp(block.timestamp + 2 hours);

        uint256 clientBefore = usdc.balanceOf(clientAddr);
        delivered.claimRefund(jobId);

        assertEq(usdc.balanceOf(clientAddr), clientBefore + AMOUNT);

        (Delivered.ProviderStats memory stats,) = delivered.getProviderStats(providerAddr);
        assertEq(stats.jobsExpired, 1);
        assertEq(uint8(_jobStatus(jobId)), uint8(Delivered.JobStatus.Expired));
    }

    // ── Test 6: Evaluator timeout (submitted, 24h+) → claimRefund ──────────
    function test_EvaluatorTimeout_ClaimRefund() public {
        uint256 jobId = _createAndFundJob();
        _submitDelivered(jobId);

        vm.warp(block.timestamp + 24 hours + 1);

        uint256 clientBefore = usdc.balanceOf(clientAddr);
        delivered.claimRefund(jobId);

        assertEq(usdc.balanceOf(clientAddr), clientBefore + AMOUNT);

        (Delivered.ProviderStats memory stats,) = delivered.getProviderStats(providerAddr);
        assertEq(stats.jobsExpired, 1);
    }
}
