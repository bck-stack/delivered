// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev No-op reputation registry — every giveFeedback call silently succeeds.
///      vm.etch this at REP_REGISTRY to get a registry that never reverts.
contract MockReputationRegistry {
    event FeedbackGiven(uint256 agentId, int128 value, string tag2);

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 /*valueDecimals*/,
        string calldata /*tag1*/,
        string calldata tag2,
        string calldata /*endpoint*/,
        string calldata /*feedbackURI*/,
        bytes32 /*feedbackHash*/
    ) external {
        emit FeedbackGiven(agentId, value, tag2);
    }
}

/// @dev Always-reverting reputation registry — giveFeedback always reverts.
///      Used to exercise the try/catch path and verify ReputationWriteFailed is emitted.
contract MockRevertingRegistry {
    function giveFeedback(
        uint256, /*agentId*/
        int128, /*value*/
        uint8, /*valueDecimals*/
        string calldata, /*tag1*/
        string calldata, /*tag2*/
        string calldata, /*endpoint*/
        string calldata, /*feedbackURI*/
        bytes32 /*feedbackHash*/
    ) external pure {
        revert("registry unavailable");
    }
}
