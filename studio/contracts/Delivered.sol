// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

/// @title Delivered
/// @notice Pay-on-delivery USDC escrow for AI agents buying API calls.
///         ERC-8183-style job lifecycle; ERC-8004 reputation on every outcome.
///         No fees, no admin, no upgradeability.
contract Delivered is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ── State machine ───────────────────────────────────────────────────────
    enum JobStatus {
        Created,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    // ── Storage structs ──────────────────────────────────────────────────────
    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        address payoutAddress;
        bytes32 requestHash;
        bytes32 deliveryResponseHash;
        uint256 amount;
        uint64 expiry;
        uint64 submittedAt;
        uint8 deliveryStatus; // 0 = delivered, 1 = failed
        JobStatus status;
    }

    struct ProviderStats {
        uint64 jobsCompleted;
        uint64 jobsRejected;
        uint64 jobsFailedAdmitted;
        uint64 jobsExpired;
        /// @notice Refunds caused by the evaluator not acting within EVALUATION_WINDOW.
        ///         Not counted in the score denominator — not the provider's fault.
        uint64 jobsEvaluatorTimeout;
        uint128 usdcEarned;
    }

    struct ProviderInfo {
        uint256 agentId;
        address payoutAddress;
    }

    struct DeliveryReceipt {
        uint256 jobId;
        bytes32 requestHash;
        bytes32 responseHash;
        uint8 status; // 0 = delivered, 1 = failed
        uint64 deliveredAt;
    }

    // ── Constants ───────────────────────────────────────────────────────────
    uint256 public constant EVALUATION_WINDOW = 24 hours;
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    bytes32 private constant DELIVERY_RECEIPT_TYPEHASH = keccak256(
        "DeliveryReceipt(uint256 jobId,bytes32 requestHash,bytes32 responseHash,uint8 status,uint64 deliveredAt)"
    );

    IERC20 private constant _USDC_TOKEN = IERC20(USDC);

    // ── Immutables ──────────────────────────────────────────────────────────
    /// @notice ERC-8004 reputation registry. Pass address(0) to disable reputation writes.
    ///         Arc Testnet: 0x8004B663056A597Dffe9eCcC1965A193B7388713
    ///         Arc Mainnet: 0x8004B663056A597Dffe9eCcC1965A193B7388713  (verify before deploy)
    address public immutable reputationRegistry;

    // ── State ────────────────────────────────────────────────────────────────
    uint256 public nextJobId = 1;

    mapping(uint256 => Job) public jobs;
    mapping(address => ProviderStats) public providerStats;
    mapping(address => ProviderInfo) public providerInfo;
    mapping(address => address) public providerSigners;
    mapping(bytes32 => bool) public usedSignatures;

    // ── Events ────────────────────────────────────────────────────────────────
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        bytes32 requestHash,
        uint256 amount,
        uint64 expiry
    );
    event Funded(uint256 indexed jobId, address indexed client, uint256 amount);
    event DeliverySubmitted(uint256 indexed jobId, bytes32 responseHash, uint8 deliveryStatus, uint64 deliveredAt);
    event JobCompleted(
        uint256 indexed jobId,
        address indexed evaluator,
        bytes32 reasonHash,
        address payoutAddress,
        uint256 amount
    );
    event JobRejected(uint256 indexed jobId, address indexed evaluator, bytes32 reasonHash);
    event Refunded(uint256 indexed jobId, address indexed recipient, uint256 amount);
    event ScoreUpdated(
        address indexed provider,
        uint64 jobsCompleted,
        uint64 jobsRejected,
        uint64 jobsFailedAdmitted,
        uint64 jobsExpired,
        uint64 jobsEvaluatorTimeout,
        uint8 score
    );
    event DeliverySignerSet(address indexed provider, address indexed newSigner);
    event ProviderRegistered(address indexed provider, uint256 agentId, address payoutAddress);
    /// @notice Emitted when an ERC-8004 reputation write fails (silenced via try/catch).
    event ReputationWriteFailed(address indexed provider, uint256 agentId, string tag);

    // ── Errors ────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error InvalidExpiry();
    error InvalidAmount();
    error InvalidStatus();
    error InvalidJobState();
    error NotJobClient();
    error NotJobEvaluator();
    error NotDeliverySigner();
    error SignerNotConfigured();
    error SignatureAlreadyUsed();
    error InvalidSignature();
    error InvalidSignatureRequestHash();
    error FutureDeliveredAt();
    error JobExpired();
    error EvaluatorCannotBeProvider();
    error RefundNotAvailable();

    // ── Constructor ────────────────────────────────────────────────────────
    /// @param _reputationRegistry ERC-8004 reputation registry address, or address(0) to disable.
    constructor(address _reputationRegistry) EIP712("Delivered", "1") {
        reputationRegistry = _reputationRegistry;
    }

    // ── Provider setup ─────────────────────────────────────────────────────
    function setDeliverySigner(address newSigner) external {
        if (newSigner == address(0)) revert ZeroAddress();
        providerSigners[msg.sender] = newSigner;
        emit DeliverySignerSet(msg.sender, newSigner);
    }

    function registerProvider(uint256 agentId, address payoutAddress) external {
        if (payoutAddress == address(0)) revert ZeroAddress();
        providerInfo[msg.sender] = ProviderInfo({agentId: agentId, payoutAddress: payoutAddress});
        emit ProviderRegistered(msg.sender, agentId, payoutAddress);
    }

    // ── Job creation ────────────────────────────────────────────────────────
    /// @notice Create and fund a job atomically. Caller must have approved USDC first.
    function createAndFundJob(
        address provider,
        address evaluator,
        uint64 expiry,
        bytes32 requestHash,
        uint256 amount
    ) external nonReentrant returns (uint256 jobId) {
        jobId = _createJob(msg.sender, provider, evaluator, expiry, requestHash, amount);

        Job storage job = jobs[jobId];
        job.status = JobStatus.Funded;

        _USDC_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(jobId, msg.sender, amount);
    }

    /// @notice Create a job without funding. Fund separately with fundJob().
    function createJob(
        address provider,
        address evaluator,
        uint64 expiry,
        bytes32 requestHash,
        uint256 amount
    ) external returns (uint256 jobId) {
        jobId = _createJob(msg.sender, provider, evaluator, expiry, requestHash, amount);
    }

    function fundJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJobState();
        if (job.client != msg.sender) revert NotJobClient();
        if (job.status != JobStatus.Created) revert InvalidJobState();

        job.status = JobStatus.Funded;

        _USDC_TOKEN.safeTransferFrom(msg.sender, address(this), job.amount);
        emit Funded(jobId, msg.sender, job.amount);
    }

    // ── Delivery ────────────────────────────────────────────────────────────
    /// @notice Submit a delivery receipt signed off-chain by the provider's delivery signer.
    ///         Anyone (client, evaluator, relayer) may call this.
    function submitWithSignature(
        uint256 jobId,
        bytes32 responseHash,
        uint8 status,
        uint64 deliveredAt,
        bytes calldata signature
    ) external {
        Job storage job = jobs[jobId];
        if (job.id == 0 || job.status != JobStatus.Funded) revert InvalidJobState();
        if (block.timestamp > job.expiry) revert JobExpired();
        if (status > 1) revert InvalidStatus();
        if (deliveredAt > block.timestamp) revert FutureDeliveredAt();

        address currentSigner = providerSigners[job.provider];
        if (currentSigner == address(0)) revert SignerNotConfigured();

        bytes32 signatureHash = keccak256(signature);
        if (usedSignatures[signatureHash]) revert SignatureAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(DELIVERY_RECEIPT_TYPEHASH, jobId, job.requestHash, responseHash, status, deliveredAt)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);

        if (recoveredSigner != currentSigner) revert InvalidSignature();

        usedSignatures[signatureHash] = true;
        _markSubmitted(job, responseHash, status);

        emit DeliverySubmitted(jobId, responseHash, status, deliveredAt);
    }

    /// @notice Submit delivery when the delivery signer sends the tx themselves.
    function submit(uint256 jobId, bytes32 responseHash) external {
        Job storage job = jobs[jobId];
        if (job.id == 0 || job.status != JobStatus.Funded) revert InvalidJobState();
        if (block.timestamp > job.expiry) revert JobExpired();

        address currentSigner = providerSigners[job.provider];
        if (currentSigner == address(0)) revert SignerNotConfigured();
        if (msg.sender != currentSigner) revert NotDeliverySigner();

        _markSubmitted(job, responseHash, 0);
        emit DeliverySubmitted(jobId, responseHash, 0, uint64(block.timestamp));
    }

    // ── Evaluation ──────────────────────────────────────────────────────────
    /// @notice Evaluator approves delivery — USDC goes to provider's payout address.
    function complete(uint256 jobId, bytes32 reasonHash) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0 || job.status != JobStatus.Submitted) revert InvalidJobState();
        if (msg.sender != job.evaluator) revert NotJobEvaluator();
        if (job.deliveryStatus != 0) revert InvalidJobState();

        job.status = JobStatus.Completed;

        _USDC_TOKEN.safeTransfer(job.payoutAddress, job.amount);

        ProviderStats storage stats = providerStats[job.provider];
        stats.jobsCompleted += 1;
        stats.usdcEarned += uint128(job.amount);

        _writeFeedback(job.provider, 10, "completed", reasonHash);

        emit JobCompleted(jobId, msg.sender, reasonHash, job.payoutAddress, job.amount);
        _emitScoreUpdated(job.provider);
    }

    /// @notice Evaluator rejects delivery — USDC goes back to client.
    function reject(uint256 jobId, bytes32 reasonHash) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0 || job.status != JobStatus.Submitted) revert InvalidJobState();
        if (msg.sender != job.evaluator) revert NotJobEvaluator();
        if (job.deliveryStatus != 0) revert InvalidJobState();

        job.status = JobStatus.Rejected;

        _USDC_TOKEN.safeTransfer(job.client, job.amount);

        ProviderStats storage stats = providerStats[job.provider];
        stats.jobsRejected += 1;

        _writeFeedback(job.provider, -10, "rejected", reasonHash);

        emit JobRejected(jobId, msg.sender, reasonHash);
        emit Refunded(jobId, job.client, job.amount);
        _emitScoreUpdated(job.provider);
    }

    // ── Automatic refunds ───────────────────────────────────────────────────
    /// @notice Claim a refund on any of three automatic paths:
    ///         1. Admitted failure (deliveryStatus == 1)
    ///         2. Expiry without any submission (still Funded after expiry)
    ///         3. Evaluator timeout (Submitted, deliveryStatus == 0, 24 h passed)
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJobState();

        bool isAdmittedFailure = job.status == JobStatus.Submitted && job.deliveryStatus == 1;
        bool isExpiredWithoutSubmission = job.status == JobStatus.Funded && block.timestamp >= job.expiry;
        bool isEvaluatorTimeout =
            job.status == JobStatus.Submitted &&
            job.deliveryStatus == 0 &&
            block.timestamp >= uint256(job.submittedAt) + EVALUATION_WINDOW;

        if (!isAdmittedFailure && !isExpiredWithoutSubmission && !isEvaluatorTimeout) revert RefundNotAvailable();

        ProviderStats storage stats = providerStats[job.provider];

        if (isAdmittedFailure) {
            job.status = JobStatus.Rejected;
            stats.jobsFailedAdmitted += 1;
            _writeFeedback(job.provider, -2, "failed-admitted", _admittedFailureHash(jobId));
        } else if (isEvaluatorTimeout) {
            // Provider delivered on time; the evaluator failed to act.
            // Count separately, exclude from score, write no negative feedback.
            job.status = JobStatus.Expired;
            stats.jobsEvaluatorTimeout += 1;
            // No reputation feedback — provider is not at fault.
        } else {
            // Expiry without any submission — provider's fault.
            job.status = JobStatus.Expired;
            stats.jobsExpired += 1;
            _writeFeedback(job.provider, -5, "expired", _expiredHash(jobId));
        }

        _USDC_TOKEN.safeTransfer(job.client, job.amount);

        emit Refunded(jobId, job.client, job.amount);
        _emitScoreUpdated(job.provider);
    }

    // ── Views ────────────────────────────────────────────────────────────────
    /// @notice Returns stats and a 0–100 score.
    ///         score = completed * 100 / (completed + rejected + expired)
    ///         jobsEvaluatorTimeout is excluded from the denominator.
    ///         Default for zero total: 50 (neutral, no data).
    function getProviderStats(address provider) external view returns (ProviderStats memory stats, uint8 score) {
        stats = providerStats[provider];

        uint256 denominator = uint256(stats.jobsCompleted) + uint256(stats.jobsRejected) + uint256(stats.jobsExpired);
        if (denominator == 0) {
            score = 50;
        } else {
            // forge-lint: disable-next-line(unsafe-typecast)
            score = uint8((uint256(stats.jobsCompleted) * 100) / denominator);
        }
    }

    // ── Internal helpers ─────────────────────────────────────────────────────
    function _createJob(
        address client,
        address provider,
        address evaluator,
        uint64 expiry,
        bytes32 requestHash,
        uint256 amount
    ) internal returns (uint256 jobId) {
        if (provider == address(0) || evaluator == address(0)) revert ZeroAddress();
        if (evaluator == provider) revert EvaluatorCannotBeProvider();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (amount == 0) revert InvalidAmount();
        if (providerSigners[provider] == address(0)) revert SignerNotConfigured();

        // Snapshot the provider's registered payout address so it cannot be changed mid-job.
        address payoutAddress = providerInfo[provider].payoutAddress;
        if (payoutAddress == address(0)) revert ZeroAddress();

        jobId = nextJobId++;

        jobs[jobId] = Job({
            id: jobId,
            client: client,
            provider: provider,
            evaluator: evaluator,
            payoutAddress: payoutAddress,
            requestHash: requestHash,
            deliveryResponseHash: bytes32(0),
            amount: amount,
            expiry: expiry,
            submittedAt: 0,
            deliveryStatus: 0,
            status: JobStatus.Created
        });

        emit JobCreated(jobId, client, provider, evaluator, requestHash, amount, expiry);
    }

    function _markSubmitted(Job storage job, bytes32 responseHash, uint8 status) internal {
        job.deliveryResponseHash = responseHash;
        job.deliveryStatus = status;
        job.submittedAt = uint64(block.timestamp);
        job.status = JobStatus.Submitted;
    }

    function _emitScoreUpdated(address provider) internal {
        ProviderStats memory stats = providerStats[provider];
        uint256 denominator = uint256(stats.jobsCompleted) + uint256(stats.jobsRejected) + uint256(stats.jobsExpired);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 score = denominator == 0 ? 50 : uint8((uint256(stats.jobsCompleted) * 100) / denominator);

        emit ScoreUpdated(
            provider,
            stats.jobsCompleted,
            stats.jobsRejected,
            stats.jobsFailedAdmitted,
            stats.jobsExpired,
            stats.jobsEvaluatorTimeout,
            score
        );
    }

    /// @dev Writes ERC-8004 reputation feedback. Silenced via try/catch.
    ///      Emits ReputationWriteFailed when the registry call reverts, so the failure is visible in logs.
    function _writeFeedback(address provider, int128 value, string memory tag2, bytes32 feedbackHash) internal {
        if (reputationRegistry == address(0)) return;
        uint256 agentId = providerInfo[provider].agentId;
        if (agentId == 0) return;

        try
            IReputationRegistry(reputationRegistry).giveFeedback(
                agentId,
                value,
                0,
                "delivered",
                tag2,
                "",
                "",
                feedbackHash
            )
        {} catch {
            emit ReputationWriteFailed(provider, agentId, tag2);
        }
    }

    function _admittedFailureHash(uint256 jobId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("failed-admitted", jobId));
    }

    function _expiredHash(uint256 jobId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("expired", jobId));
    }
}
