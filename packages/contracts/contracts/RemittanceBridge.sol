// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {ITokenGateway} from "./interfaces/ITokenGateway.sol";

/**
 * @title RemittanceBridge
 * @notice Wraps Hyperbridge's ITokenGateway for cross-chain USDC remittances.
 *
 * @dev MOCK MODE (gateway == address(0)):
 *   Simulates cross-chain by local USDC transfer to recipient.
 *   This lets you demo the full UX flow without live bridge infra.
 *
 * @dev LIVE MODE:
 *   Calls ITokenGateway.teleport() to lock USDC on Polkadot Hub.
 *   Hyperbridge relayers deliver USDC to recipient on dest chain (1-5 min).
 *
 * @dev ACCESS CONTROL:
 *   Only LendingPool can call sendRemittance().
 *   Bridge pulls USDC from caller via safeTransferFrom.
 *
 * @dev SUPPORTED DESTINATION CHAINS (via Hyperbridge):
 *   1      = Ethereum Mainnet
 *   56     = BNB Smart Chain
 *   8453   = Base
 *   42161  = Arbitrum One
 *   10     = Optimism
 */
contract RemittanceBridge is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ─── Types ──────────────────────────────────────────────────────────────
    enum TransferStatus { Pending, Completed, Failed }

    struct Transfer {
        address  sender;
        address  recipient;
        uint256  usdcAmount;
        uint256  destChainId;
        uint256  timestamp;
        TransferStatus status;
    }

    // ─── State ──────────────────────────────────────────────────────────────
    ITokenGateway public  hyperbridgeGateway;
    IERC20        public  immutable usdc;
    address       public  lendingPool;
    mapping(bytes32 => Transfer) public transfers;
    uint256       public  transferCount;

    // ─── Events ─────────────────────────────────────────────────────────────
    event RemittanceSent(
        bytes32 indexed transferId,
        address indexed sender,
        address         recipient,
        uint256         usdcAmount,
        uint256         destChainId
    );
    event RemittanceCompleted(bytes32 indexed transferId);
    event RemittanceFailed(bytes32 indexed transferId, string reason);
    event GatewayUpdated(address indexed gateway);
    event LendingPoolSet(address indexed lendingPool);

    // ─── Modifiers ──────────────────────────────────────────────────────────
    modifier onlyLendingPool() {
        require(msg.sender == lendingPool, "Bridge: caller is not LendingPool");
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor(
        address initialOwner,
        address usdcAddress,
        address gatewayAddress
    ) Ownable(initialOwner) {
        require(usdcAddress != address(0), "Bridge: zero USDC address");
        usdc = IERC20(usdcAddress);

        if (gatewayAddress != address(0)) {
            hyperbridgeGateway = ITokenGateway(gatewayAddress);
        }
        // gateway == address(0) → mock mode
    }

    // ─── Core ───────────────────────────────────────────────────────────────

    /**
     * @notice Send USDC cross-chain via Hyperbridge (or locally in mock mode).
     * @dev Pulls USDC from msg.sender (LendingPool) via safeTransferFrom.
     *      Caller must have approved this contract for usdcAmount.
     * @param recipient   Destination address (EVM address on dest chain)
     * @param usdcAmount  USDC amount (6 decimals)
     * @param destChainId Target EVM chain ID (must be > 0)
     */
    function sendRemittance(
        address recipient,
        uint256 usdcAmount,
        uint256 destChainId
    ) external onlyLendingPool nonReentrant {
        require(recipient   != address(0), "Bridge: zero recipient");
        require(usdcAmount  > 0,           "Bridge: zero amount");
        require(destChainId > 0,           "Bridge: zero chain ID");

        // Pull USDC from LendingPool
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Generate unique transfer ID
        bytes32 transferId = keccak256(abi.encodePacked(
            tx.origin, recipient, usdcAmount, destChainId,
            block.timestamp, transferCount++
        ));

        // Store transfer record
        transfers[transferId] = Transfer({
            sender      : tx.origin,
            recipient   : recipient,
            usdcAmount  : usdcAmount,
            destChainId : destChainId,
            timestamp   : block.timestamp,
            status      : TransferStatus.Pending
        });

        if (address(hyperbridgeGateway) == address(0)) {
            // ── MOCK MODE ──────────────────────────────────────────────
            // Simulate cross-chain: transfer USDC locally to recipient
            usdc.safeTransfer(recipient, usdcAmount);
            transfers[transferId].status = TransferStatus.Completed;
            emit RemittanceSent(transferId, tx.origin, recipient, usdcAmount, destChainId);
            emit RemittanceCompleted(transferId);
        } else {
            // ── LIVE MODE ──────────────────────────────────────────────
            _callHyperbridge(transferId, recipient, usdcAmount, destChainId);
        }
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    function _callHyperbridge(
        bytes32 transferId,
        address recipient,
        uint256 usdcAmount,
        uint256 destChainId
    ) internal {
        uint256 fee = hyperbridgeGateway.estimateFee(destChainId, usdcAmount);

        // Approve gateway to pull USDC
        usdc.forceApprove(address(hyperbridgeGateway), usdcAmount);

        bytes32 recipientBytes32 = bytes32(uint256(uint160(recipient)));

        ITokenGateway.SendParams memory params = ITokenGateway.SendParams({
            destChainId : destChainId,
            to          : recipientBytes32,
            token       : address(usdc),
            amount      : usdcAmount,
            maxFee      : fee * 2
        });

        try hyperbridgeGateway.teleport{value: fee}(params) {
            transfers[transferId].status = TransferStatus.Completed;
            emit RemittanceSent(transferId, tx.origin, recipient, usdcAmount, destChainId);
            emit RemittanceCompleted(transferId);
        } catch Error(string memory reason) {
            transfers[transferId].status = TransferStatus.Failed;
            emit RemittanceSent(transferId, tx.origin, recipient, usdcAmount, destChainId);
            emit RemittanceFailed(transferId, reason);
        }
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function estimateFee(uint256 destChainId) external view returns (uint256) {
        if (address(hyperbridgeGateway) == address(0)) return 0;
        return hyperbridgeGateway.estimateFee(destChainId, 0);
    }

    function getTransfer(bytes32 transferId) external view returns (Transfer memory) {
        return transfers[transferId];
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setGateway(address _gateway) external onlyOwner {
        require(_gateway != address(0), "Bridge: zero gateway");
        hyperbridgeGateway = ITokenGateway(_gateway);
        emit GatewayUpdated(_gateway);
    }

    function setLendingPool(address _lendingPool) external onlyOwner {
        require(_lendingPool != address(0), "Bridge: zero address");
        lendingPool = _lendingPool;
        emit LendingPoolSet(_lendingPool);
    }

    function recoverTokens(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Bridge: zero address");
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Accept native token (DOT) for Hyperbridge relay fees
    receive() external payable {}
}
