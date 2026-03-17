// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ICollateralVault {
    function lockCollateral(address user, uint256 amount) external;
    function releaseCollateral(address user, uint256 amount) external;
    function seizeCollateral(address user, uint256 amount, address recipient) external;
    function getAvailableCollateral(address user) external view returns (uint256);
    function getLockedCollateral(address user) external view returns (uint256);
}

interface IPriceOracle {
    function getDotPriceWad() external view returns (uint256);
    function getWdotValueInUsd(uint256 wdotAmount) external view returns (uint256);
}

interface IRemittanceBridge {
    function sendRemittance(
        address recipient,
        uint256 amount,
        uint32  destChainId
    ) external;
}

/**
 * @title LendingPool
 * @notice Core lending logic for DotBridge.
 *         Users borrow USDC by locking WDOT collateral.
 *         Borrowed USDC can be immediately bridged cross-chain as a remittance.
 *
 * @dev DECIMAL REFERENCE (critical — read before touching any math):
 *   WDOT:  10 decimals  (1 DOT  = 1e10 planks)
 *   USDC:   6 decimals  (1 USDC = 1e6  units)
 *   Price: 18 decimals  (WAD — normalized from Chainlink by PriceOracle)
 *   Internal math: all values normalized to 18 decimals for safe arithmetic
 *
 * @dev COLLATERAL MATH:
 *   COLLATERAL_RATIO = 150  → must hold 150% of borrowed value
 *   LIQUIDATION_THRESHOLD = 130  → health factor below 1.3 = liquidatable
 *   Health Factor = (collateralValueUSD * 100) / (debtValueUSD * COLLATERAL_RATIO)
 *   Health Factor >= 100 = safe, < 100 = liquidatable
 *
 * @dev INTEREST MODEL:
 *   Simple (not compound) interest for v1 — deliberate for auditability.
 *   Interest = principal * INTEREST_RATE_BPS * timeElapsed / (365 days * 10000)
 *
 * @dev BORROW + BRIDGE FLOW:
 *   borrow(amount, destChainId, recipient):
 *     1. Validate collateral ratio
 *     2. Create/update position
 *     3. Lock WDOT in CollateralVault
 *     4. Transfer USDC to RemittanceBridge
 *     5. RemittanceBridge calls Hyperbridge → USDC lands on dest chain
 */
contract LendingPool is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant COLLATERAL_RATIO     = 150; // 150%
    uint256 public constant LIQ_THRESHOLD        = 130; // 130%
    uint256 public constant LIQ_BONUS            = 5;   // 5% bonus to liquidator
    uint256 public constant INTEREST_RATE_BPS    = 500; // 5% per year (basis points)
    uint256 public constant SECONDS_PER_YEAR     = 365 days;

    // Precision constants for decimal normalization
    uint256 public constant WDOT_DECIMALS_FACTOR = 1e10; // WDOT: 10 decimals
    uint256 public constant USDC_DECIMALS_FACTOR = 1e6;  // USDC:  6 decimals
    uint256 public constant PRICE_DECIMALS_FACTOR = 1e8; // Price: 8 decimals
    uint256 public constant PRECISION_18          = 1e18; // Internal 18 dec

    // ─── Structs ─────────────────────────────────────────────────────────────
    struct Position {
        uint256 collateralAmount; // WDOT locked (10 decimals)
        uint256 debtPrincipal;    // USDC borrowed at open time (6 decimals)
        uint256 borrowTimestamp;  // block.timestamp when position opened
        bool    isActive;
    }

    // ─── State ───────────────────────────────────────────────────────────────
    IERC20             public immutable usdc;
    ICollateralVault   public immutable vault;
    IPriceOracle       public immutable oracle;
    IRemittanceBridge  public           bridge;
    bool               private          bridgeSet;

    mapping(address => Position) public positions;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Borrowed(address indexed user, uint256 usdcAmount, uint256 wdotLocked, uint32 destChainId, address recipient);
    event Repaid(address indexed user, uint256 principal, uint256 interest);
    event Liquidated(address indexed user, address indexed liquidator, uint256 wdotSeized, uint256 debtCovered);
    event BridgeSet(address indexed bridge);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(
        address _usdc,
        address _vault,
        address _oracle
    ) Ownable(msg.sender) {
        require(_usdc   != address(0), "LendingPool: zero usdc");
        require(_vault  != address(0), "LendingPool: zero vault");
        require(_oracle != address(0), "LendingPool: zero oracle");
        usdc   = IERC20(_usdc);
        vault  = ICollateralVault(_vault);
        oracle = IPriceOracle(_oracle);
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    /// @notice Set RemittanceBridge. Called once after bridge is deployed.
    function setBridge(address _bridge) external onlyOwner {
        require(!bridgeSet, "LendingPool: bridge already set");
        require(_bridge != address(0), "LendingPool: zero address");
        bridge    = IRemittanceBridge(_bridge);
        bridgeSet = true;
        emit BridgeSet(_bridge);
    }

    // ─── Core Actions ────────────────────────────────────────────────────────

    /**
     * @notice Borrow USDC against WDOT collateral and bridge it cross-chain.
     * @param usdcAmount  Amount of USDC to borrow (6 decimals)
     * @param destChainId EVM chain ID of destination (1=ETH, 56=BNB, 8453=Base)
     * @param recipient   Address on destination chain to receive USDC
     *
     * @dev Collateral must already be deposited in CollateralVault.
     *      This function does NOT accept token transfers — deposit WDOT first.
     */
    function borrow(
        uint256 usdcAmount,
        uint32  destChainId,
        address recipient
    ) external nonReentrant whenNotPaused {
        require(usdcAmount > 0,         "LendingPool: amount must be > 0");
        require(recipient != address(0),"LendingPool: zero recipient");
        require(!positions[msg.sender].isActive, "LendingPool: repay existing loan first");

        // --- Collateral check ---
        uint256 freeWdot = vault.getAvailableCollateral(msg.sender);
        require(freeWdot > 0, "LendingPool: no free collateral");

        // How much WDOT is needed to back this borrow?
        uint256 requiredWdot = _requiredCollateral(usdcAmount);
        require(freeWdot >= requiredWdot, "LendingPool: insufficient collateral");

        // --- State update (before external calls: CEI pattern) ---
        positions[msg.sender] = Position({
            collateralAmount : requiredWdot,
            debtPrincipal    : usdcAmount,
            borrowTimestamp  : block.timestamp,
            isActive         : true
        });

        // --- Lock collateral in vault ---
        vault.lockCollateral(msg.sender, requiredWdot);

        // --- Transfer USDC to bridge and trigger cross-chain send ---
        // LendingPool must hold enough USDC liquidity (funded by protocol at launch)
        usdc.safeTransfer(address(bridge), usdcAmount);
        bridge.sendRemittance(recipient, usdcAmount, destChainId);

        emit Borrowed(msg.sender, usdcAmount, requiredWdot, destChainId, recipient);
    }

    /**
     * @notice Repay USDC debt + accrued interest to unlock WDOT collateral.
     * @dev Caller must approve LendingPool for (principal + interest) USDC.
     *      Call getRepayAmount(user) first to get the exact amount needed.
     */
    function repay() external nonReentrant {
        Position storage pos = positions[msg.sender];
        require(pos.isActive, "LendingPool: no active position");

        uint256 interest   = _accruedInterest(pos.debtPrincipal, pos.borrowTimestamp);
        uint256 totalOwed  = pos.debtPrincipal + interest;

        uint256 wdotToRelease = pos.collateralAmount;
        uint256 principal     = pos.debtPrincipal;

        // --- Clear position BEFORE transfers (CEI) ---
        delete positions[msg.sender];

        // --- Pull repayment from user ---
        usdc.safeTransferFrom(msg.sender, address(this), totalOwed);

        // --- Release collateral ---
        vault.releaseCollateral(msg.sender, wdotToRelease);

        emit Repaid(msg.sender, principal, interest);
    }

    /**
     * @notice Liquidate an undercollateralized position.
     * @dev Anyone can call this. Liquidator supplies the debt, receives
     *      collateral + 5% bonus. Remainder (if any) returns to the user.
     * @param user Address of the undercollateralized borrower
     */
    function liquidate(address user) external nonReentrant {
        Position storage pos = positions[user];
        require(pos.isActive, "LendingPool: no active position");
        require(_healthFactor(user) < 100, "LendingPool: position is healthy");

        uint256 totalDebt     = pos.debtPrincipal + _accruedInterest(pos.debtPrincipal, pos.borrowTimestamp);
        uint256 wdotCollateral = pos.collateralAmount;

        // Liquidator covers the full debt
        // They receive collateral + LIQ_BONUS %
        uint256 wdotForLiquidator = _debtToWdot(totalDebt) * (100 + LIQ_BONUS) / 100;
        if (wdotForLiquidator > wdotCollateral) {
            wdotForLiquidator = wdotCollateral; // cap at available collateral
        }
        uint256 wdotRemainder = wdotCollateral - wdotForLiquidator;

        // --- Clear position BEFORE transfers (CEI) ---
        delete positions[user];

        // --- Pull debt from liquidator ---
        usdc.safeTransferFrom(msg.sender, address(this), totalDebt);

        // --- Seize collateral → liquidator ---
        vault.seizeCollateral(user, wdotForLiquidator, msg.sender);

        // --- Return remainder to user (if any) ---
        if (wdotRemainder > 0) {
            vault.seizeCollateral(user, wdotRemainder, user);
        }

        emit Liquidated(user, msg.sender, wdotForLiquidator, totalDebt);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /**
     * @notice Get the current health factor for a user (100 = safe boundary)
     * @return hf Health factor (100 = exactly at limit, >100 = safe, <100 = liquidatable)
     */
    function healthFactor(address user) external view returns (uint256 hf) {
        return _healthFactor(user);
    }

    /**
     * @notice Get the total amount owed (principal + accrued interest) for a user
     * @return totalOwed USDC amount (6 decimals)
     */
    function getRepayAmount(address user) external view returns (uint256 totalOwed) {
        Position storage pos = positions[user];
        if (!pos.isActive) return 0;
        return pos.debtPrincipal + _accruedInterest(pos.debtPrincipal, pos.borrowTimestamp);
    }

    /**
     * @notice How much WDOT collateral is needed to borrow `usdcAmount`
     * @param usdcAmount USDC amount (6 decimals)
     * @return wdotNeeded WDOT amount in planks (10 decimals)
     */
    function requiredCollateral(uint256 usdcAmount) external view returns (uint256 wdotNeeded) {
        return _requiredCollateral(usdcAmount);
    }

    // ─── Internal Helpers ────────────────────────────────────────────────────

    function _healthFactor(address user) internal view returns (uint256) {
        Position storage pos = positions[user];
        if (!pos.isActive) return type(uint256).max;

        uint256 totalDebt18    = _toUsd18(pos.debtPrincipal + _accruedInterest(pos.debtPrincipal, pos.borrowTimestamp), false);
        uint256 collateral18   = oracle.getWdotValueInUsd(pos.collateralAmount);

        if (totalDebt18 == 0) return type(uint256).max;

        // Health factor: (collateral * 100) / (debt * LIQ_THRESHOLD / 100)
        // Scaled to integer: 100 = safe boundary
        return (collateral18 * 100 * 100) / (totalDebt18 * LIQ_THRESHOLD);
    }

    function _requiredCollateral(uint256 usdcAmount) internal view returns (uint256) {
        // usdcAmount (6 dec) → usd18 (18 dec)
        uint256 usdNeeded18 = _toUsd18(usdcAmount, false) * COLLATERAL_RATIO / 100;

        // usd18 → wdot (10 dec) using WAD price
        uint256 dotPriceWad = oracle.getDotPriceWad(); // 18 dec
        // wdotAmount = usdNeeded18 * 1e10 / dotPriceWad
        // (18dec * 10dec) / 18dec = 10dec ✓
        return (usdNeeded18 * WDOT_DECIMALS_FACTOR) / dotPriceWad;
    }

    function _debtToWdot(uint256 usdcAmount) internal view returns (uint256) {
        return _requiredCollateral(usdcAmount * 100 / COLLATERAL_RATIO);
    }

    function _accruedInterest(uint256 principal, uint256 borrowTimestamp) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - borrowTimestamp;
        // interest = principal * rate * time / (year * 10000)
        return (principal * INTEREST_RATE_BPS * elapsed) / (SECONDS_PER_YEAR * 10000);
    }

    /// @dev Convert token amount to 18 decimal USD value
    /// @param isWdot true for WDOT amounts, false for USDC amounts
    function _toUsd18(uint256 amount, bool isWdot) internal pure returns (uint256) {
        if (isWdot) {
            // WDOT: 10 dec → 18 dec: multiply by 1e8
            return amount * 1e8;
        } else {
            // USDC: 6 dec → 18 dec: multiply by 1e12
            return amount * 1e12;
        }
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// @notice Pause borrow and bridge (repay always stays open)
    function pause() external onlyOwner { _pause(); }

    /// @notice Unpause
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Recover mistakenly sent tokens (not USDC collateral)
    function recoverToken(address token, uint256 amount) external onlyOwner {
        require(token != address(usdc), "LendingPool: cannot recover USDC");
        IERC20(token).safeTransfer(owner(), amount);
    }
}
