// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title SimpleMockBridge
 * @notice Minimal mock for testing LendingPool bridge integration.
 *         Records the last call to sendRemittance so tests can verify args.
 */
contract SimpleMockBridge {
    address public lastRecipient;
    uint256 public lastAmount;
    uint256 public lastDestChainId;
    uint256 public callCount;

    function sendRemittance(
        address recipient,
        uint256 usdcAmount,
        uint256 destChainId
    ) external {
        lastRecipient   = recipient;
        lastAmount      = usdcAmount;
        lastDestChainId = destChainId;
        callCount++;
    }
}
