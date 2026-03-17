// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockHyperbridgeGateway
 * @notice Simulates Hyperbridge ITokenGateway for unit tests.
 * @dev Accepts token allowances and emits TeleportInitiated.
 *      Does NOT actually bridge anything.
 */
contract MockHyperbridgeGateway {
    using SafeERC20 for IERC20;

    struct TeleportParams {
        uint256  amount;
        address  relayerFee;
        uint256  timeout;
        bytes32  to;
        uint256  destChain;
        address  assetId;
    }

    event TeleportInitiated(address indexed assetId, bytes32 to, uint256 amount, uint256 destChain);

    function teleport(TeleportParams memory params) external payable {
        require(params.amount > 0,          "MockGateway: zero amount");
        require(params.assetId != address(0),"MockGateway: zero asset");
        IERC20(params.assetId).safeTransferFrom(msg.sender, address(this), params.amount);
        emit TeleportInitiated(params.assetId, params.to, params.amount, params.destChain);
    }

    function feeToken() external pure returns (address) { return address(0); }
    function calculateFee(uint256, uint256) external pure returns (uint256) { return 0; }
}
