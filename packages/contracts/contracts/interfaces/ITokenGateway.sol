// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title ITokenGateway
 * @notice Hyperbridge Token Gateway interface for cross-chain asset transfers.
 *
 * @dev Source: https://docs.hyperbridge.network/developers/evm/token-gateway
 *      The Token Gateway is deployed on Polkadot Hub testnet.
 *      Our RemittanceBridge wraps this interface with access control and
 *      transfer-status tracking on top.
 *
 *      Testnet Gateway address (Westend Hub): TBD — check Hyperbridge docs
 *      before deployment. Use address(0) in mock mode.
 */
interface ITokenGateway {
    struct SendParams {
        /// @dev EVM chain ID of the destination chain
        uint256 destChainId;
        /// @dev Recipient address on the destination chain (bytes32 for cross-VM compat)
        bytes32 to;
        /// @dev ERC-20 token address on the source chain to bridge
        address token;
        /// @dev Amount to send (in token's native decimals)
        uint256 amount;
        /// @dev Max accepted fee (in source token) — set high for testnet
        uint256 maxFee;
    }

    /**
     * @notice Initiates a cross-chain token transfer.
     * @return commitment Unique identifier for this transfer (bytes32)
     */
    function teleport(SendParams calldata params) external payable returns (bytes32 commitment);

    /**
     * @notice Estimates the relayer fee for a cross-chain transfer.
     * @return fee Fee amount in native token (DOT planck on Hub)
     */
    function estimateFee(uint256 destChainId, uint256 amount) external view returns (uint256 fee);

    /// @notice Returns the body of a pending transfer by its commitment
    function pendingTransfers(bytes32 commitment) external view returns (bool exists);
}
