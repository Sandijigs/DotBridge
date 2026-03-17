// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RemittanceBridge
 * @notice Thin wrapper around Hyperbridge's ITokenGateway.
 *         Receives USDC from LendingPool and initiates cross-chain transfers.
 *
 * @dev HYPERBRIDGE INTEGRATION:
 *   Hyperbridge's Token Gateway (ITokenGateway) handles the actual cross-chain
 *   mechanics via ISMP (Interoperable State Machine Protocol).
 *   SDK docs: https://docs.hyperbridge.network/developers/evm/token-gateway
 *   Testnet gateway: Deployed on Westend Asset Hub (check .env for address)
 *
 * @dev SUPPORTED DESTINATION CHAINS (via Hyperbridge):
 *   1      = Ethereum Mainnet
 *   56     = BNB Smart Chain
 *   8453   = Base
 *   42161  = Arbitrum One
 *   10     = Optimism
 *
 * @dev TRANSFER FLOW:
 *   1. LendingPool calls sendRemittance(recipient, amount, destChainId)
 *   2. RemittanceBridge approves ITokenGateway for USDC amount
 *   3. ITokenGateway.teleport() locks USDC on Polkadot Hub
 *   4. Hyperbridge relayers pick up the ISMP message
 *   5. USDC appears in recipient's wallet on dest chain (1-5 min)
 *
 * @dev FALLBACK — MOCK MODE:
 *   If gateway address is zero (testnet before Hyperbridge is live),
 *   the contract falls back to a local transfer + event emission.
 *   This lets you demo the full UX flow without live bridge infra.
 */

interface ITokenGateway {
    struct TeleportParams {
        uint256  amount;       // Token amount to bridge
        address  relayerFee;   // Relayer fee in token (often 0 on testnet)
        uint256  timeout;      // ISMP timeout in seconds (0 = no timeout)
        bytes32  to;           // Recipient address as bytes32 (right-padded)
        uint256  destChain;    // Destination EVM chain ID
        address  assetId;      // ERC-20 token address to bridge
    }

    function teleport(TeleportParams memory params) external payable;
    function feeToken() external view returns (address);
    function calculateFee(uint256 destChain, uint256 amount) external view returns (uint256);
}

contract RemittanceBridge is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────
    IERC20          public immutable usdc;
    ITokenGateway   public           gateway;
    address         public           lendingPool;
    bool            private          lendingPoolSet;
    bool            public           mockMode;

    // Transfer tracking
    enum TransferStatus { Pending, Completed, Failed }

    struct TransferRecord {
        address sender;
        address recipient;
        uint256 amount;
        uint32  destChainId;
        uint256 timestamp;
        TransferStatus status;
    }

    mapping(bytes32 => TransferRecord) public transfers;
    uint256 private transferNonce;

    // ─── Events ──────────────────────────────────────────────────────────────
    event RemittanceSent(
        bytes32 indexed transferId,
        address indexed sender,
        address          recipient,
        uint256          amount,
        uint32           destChainId
    );
    event RemittanceCompleted(bytes32 indexed transferId);
    event RemittanceFailed(bytes32 indexed transferId, string reason);
    event GatewaySet(address indexed gateway);
    event LendingPoolSet(address indexed lendingPool);
    event MockModeSet(bool enabled);

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyLendingPool() {
        require(msg.sender == lendingPool, "RemittanceBridge: caller is not LendingPool");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address initialOwner, address _usdc, address _gateway) Ownable(initialOwner) {
        require(_usdc != address(0), "RemittanceBridge: zero usdc");
        usdc = IERC20(_usdc);

        if (_gateway != address(0)) {
            gateway  = ITokenGateway(_gateway);
            mockMode = false;
        } else {
            mockMode = true; // No gateway → mock mode for testnet dev
        }
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setLendingPool(address _lendingPool) external onlyOwner {
        require(!lendingPoolSet, "RemittanceBridge: already set");
        require(_lendingPool != address(0), "RemittanceBridge: zero address");
        lendingPool    = _lendingPool;
        lendingPoolSet = true;
        emit LendingPoolSet(_lendingPool);
    }

    function setGateway(address _gateway) external onlyOwner {
        require(_gateway != address(0), "RemittanceBridge: zero address");
        gateway  = ITokenGateway(_gateway);
        mockMode = false;
        emit GatewaySet(_gateway);
    }

    function enableMockMode() external onlyOwner {
        mockMode = true;
        emit MockModeSet(true);
    }

    // ─── Core ────────────────────────────────────────────────────────────────

    /**
     * @notice Send USDC cross-chain via Hyperbridge.
     * @dev Called exclusively by LendingPool after transferring USDC here.
     * @param recipient   Destination address (EVM address on dest chain)
     * @param amount      USDC amount (6 decimals)
     * @param destChainId Target EVM chain ID
     */
    function sendRemittance(
        address recipient,
        uint256 amount,
        uint32  destChainId
    ) external onlyLendingPool nonReentrant {
        require(amount > 0, "RemittanceBridge: zero amount");
        require(recipient != address(0), "RemittanceBridge: zero recipient");

        bytes32 transferId = _generateTransferId(msg.sender, recipient, amount, destChainId);

        transfers[transferId] = TransferRecord({
            sender    : msg.sender,
            recipient : recipient,
            amount    : amount,
            destChainId: destChainId,
            timestamp : block.timestamp,
            status    : TransferStatus.Pending
        });

        emit RemittanceSent(transferId, msg.sender, recipient, amount, destChainId);

        if (mockMode) {
            // Mock mode: immediately mark complete (for testnet demos)
            transfers[transferId].status = TransferStatus.Completed;
            emit RemittanceCompleted(transferId);
        } else {
            _callHyperbridge(transferId, recipient, amount, destChainId);
        }
    }

    function _callHyperbridge(
        bytes32 transferId,
        address recipient,
        uint256 amount,
        uint32  destChainId
    ) internal {
        // Approve gateway to pull USDC
        usdc.safeIncreaseAllowance(address(gateway), amount);

        // Encode recipient as bytes32 (EVM addresses are 20 bytes, right-padded)
        bytes32 recipientBytes32 = bytes32(uint256(uint160(recipient)));

        ITokenGateway.TeleportParams memory params = ITokenGateway.TeleportParams({
            amount     : amount,
            relayerFee : address(0),  // no explicit relayer fee on testnet
            timeout    : 0,           // no timeout
            to         : recipientBytes32,
            destChain  : destChainId,
            assetId    : address(usdc)
        });

        try gateway.teleport(params) {
            transfers[transferId].status = TransferStatus.Completed;
            emit RemittanceCompleted(transferId);
        } catch Error(string memory reason) {
            transfers[transferId].status = TransferStatus.Failed;
            emit RemittanceFailed(transferId, reason);
        }
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getTransfer(bytes32 transferId) external view returns (TransferRecord memory) {
        return transfers[transferId];
    }

    function estimateFee(uint32 destChainId, uint256 amount) external view returns (uint256) {
        if (mockMode || address(gateway) == address(0)) return 0;
        return gateway.calculateFee(destChainId, amount);
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _generateTransferId(
        address sender,
        address recipient,
        uint256 amount,
        uint32  destChainId
    ) internal returns (bytes32) {
        return keccak256(abi.encodePacked(
            sender, recipient, amount, destChainId,
            block.timestamp, ++transferNonce
        ));
    }
}
