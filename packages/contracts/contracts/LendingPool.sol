// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {DecimalLib} from "./DecimalLib.sol";

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
        uint256 usdcAmount,
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
 *   Internal math: all values normalized to 18 decimals via DecimalLib
 *
 * @dev COLLATERAL MATH (BPS):
 *   COLLATERAL_RATIO_BPS = 15000  → must hold 150% of borrowed value
 *   LIQ_THRESHOLD_BPS    = 13000  → health factor < 1 WAD = liquidatable
 *   Health Factor = DecimalLib.healthFactor(collateralUsdWad, debtUsdWad, LIQ_THRESHOLD_BPS)
 *
 * @dev INTEREST MODEL:
 *   Simple (not compound) interest for v1 — deliberate for auditability.
 *   Interest = principal * INTEREST_RATE_BPS * timeElapsed / (BPS_BASE * SECONDS_PER_YEAR)
 *
 * @dev BORROW + BRIDGE FLOW:
 *   borrow(usdcAmount, destChainId, remitRecipient):
 *     1. Validate collateral ratio using DecimalLib
 *     2. Lock ALL available WDOT in CollateralVault
 *     3. Create position
 *     4. Transfer USDC to user or bridge
 */
contract LendingPool is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20  for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant COLLATERAL_RATIO_BPS = 15_000; // 150%
    uint256 public constant LIQ_THRESHOLD_BPS    = 13_000; // 130%
    uint256 public constant LIQ_BONUS_BPS        =    500; // 5%
    uint256 public constant INTEREST_RATE_BPS    =    500; // 5% annual
    uint256 public constant SECONDS_PER_YEAR     = 365 days;
    uint256 public constant BPS_BASE             = 10_000;

    // ─── Structs ─────────────────────────────────────────────────────────────
    struct Position {
        uint256 collateralWdot;  // raw WDOT locked (10 decimals)
        uint256 debtUsdc;        // raw USDC borrowed (6 decimals)
        uint256 borrowTimestamp; // block.timestamp when position opened
        bool    isActive;
    }

    // ─── State ───────────────────────────────────────────────────────────────
    ICollateralVault  public immutable vault;
    IPriceOracle      public immutable oracle;
    IERC20            public immutable usdc;
    IRemittanceBridge public           bridge;

    mapping(address => Position) public positions;
    uint256 public totalDebtUsdc;
    uint256 public protocolFeesUsdc;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Borrowed(address indexed user, uint256 usdcAmount, uint256 wdotLocked, uint256 destChainId, address recipient);
    event Repaid(address indexed user, uint256 principal, uint256 interest);
    event Liquidated(address indexed user, address indexed liquidator, uint256 wdotSeized, uint256 debtCovered);
    event BridgeUpdated(address indexed bridge);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(
        address initialOwner,
        address vaultAddr,
        address oracleAddr,
        address usdcAddr
    ) Ownable(initialOwner) {
        require(vaultAddr  != address(0), "LP: zero vault");
        require(oracleAddr != address(0), "LP: zero oracle");
        require(usdcAddr   != address(0), "LP: zero usdc");
        vault  = ICollateralVault(vaultAddr);
        oracle = IPriceOracle(oracleAddr);
        usdc   = IERC20(usdcAddr);
    }

    // ─── Core Actions ────────────────────────────────────────────────────────

    /**
     * @notice Borrow USDC against WDOT collateral.
     *         If destChainId != 0 and bridge is set, USDC is bridged cross-chain.
     *         Otherwise USDC is transferred directly to the caller.
     * @param usdcAmount     Amount of USDC to borrow (6 decimals)
     * @param destChainId    EVM chain ID of destination (0 = local, no bridge)
     * @param remitRecipient Address on destination chain to receive USDC
     */
    function borrow(
        uint256 usdcAmount,
        uint256 destChainId,
        address remitRecipient
    ) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "LP: zero borrow");
        require(!positions[msg.sender].isActive, "LP: position already active");

        // --- Collateral check ---
        uint256 availableWdot = vault.getAvailableCollateral(msg.sender);
        require(availableWdot > 0, "LP: no collateral deposited");

        uint256 collateralUsdWad = oracle.getWdotValueInUsd(availableWdot);
        uint256 debtUsdWad       = DecimalLib.usdcToWad(usdcAmount);
        uint256 maxBorrowWad     = DecimalLib.maxBorrow(collateralUsdWad, COLLATERAL_RATIO_BPS);
        require(debtUsdWad <= maxBorrowWad, "LP: insufficient collateral for this borrow");

        // --- Effects (before any external calls: CEI) ---
        vault.lockCollateral(msg.sender, availableWdot);

        positions[msg.sender] = Position({
            collateralWdot  : availableWdot,
            debtUsdc        : usdcAmount,
            borrowTimestamp  : block.timestamp,
            isActive         : true
        });

        totalDebtUsdc += usdcAmount;

        // --- Interactions ---
        if (destChainId != 0 && address(bridge) != address(0)) {
            require(remitRecipient != address(0), "LP: zero remit recipient");
            usdc.safeTransfer(address(bridge), usdcAmount);
            bridge.sendRemittance(remitRecipient, usdcAmount, uint32(destChainId));
        } else {
            usdc.safeTransfer(msg.sender, usdcAmount);
        }

        emit Borrowed(msg.sender, usdcAmount, availableWdot, destChainId, remitRecipient);
    }

    /**
     * @notice Repay USDC debt + accrued interest to unlock WDOT collateral.
     * @dev Caller must approve LendingPool for (principal + interest) USDC.
     */
    function repay() external nonReentrant whenNotPaused {
        Position storage pos = positions[msg.sender];
        require(pos.isActive, "LP: no active position");

        uint256 interest       = _accrueInterest(pos.debtUsdc, pos.borrowTimestamp);
        uint256 totalRepayment = pos.debtUsdc + interest;

        // --- Effects — ALL before external calls (CEI) ---
        protocolFeesUsdc         += interest;
        totalDebtUsdc            -= pos.debtUsdc;
        uint256 collateralToRelease = pos.collateralWdot;
        uint256 principalRepaid     = pos.debtUsdc;
        delete positions[msg.sender];

        // --- Interactions ---
        usdc.safeTransferFrom(msg.sender, address(this), totalRepayment);
        vault.releaseCollateral(msg.sender, collateralToRelease);

        emit Repaid(msg.sender, principalRepaid, interest);
    }

    /**
     * @notice Liquidate an undercollateralized position.
     * @dev Anyone can call. Liquidator pays the debt, receives all locked WDOT.
     * @param user Address of the undercollateralized borrower
     */
    function liquidate(address user) external nonReentrant whenNotPaused {
        Position storage pos = positions[user];
        require(pos.isActive, "LP: no active position");

        uint256 hf = getHealthFactor(user);
        require(hf < DecimalLib.WAD, "LP: position is healthy");

        uint256 interest  = _accrueInterest(pos.debtUsdc, pos.borrowTimestamp);
        uint256 totalDebt = pos.debtUsdc + interest;

        // --- Effects ---
        protocolFeesUsdc += interest;
        totalDebtUsdc    -= pos.debtUsdc;
        uint256 wdotToSeize = pos.collateralWdot;
        delete positions[user];

        // --- Interactions ---
        usdc.safeTransferFrom(msg.sender, address(this), totalDebt);
        vault.seizeCollateral(user, wdotToSeize, msg.sender);

        emit Liquidated(user, msg.sender, wdotToSeize, totalDebt);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /**
     * @notice Health factor in WAD. >= 1e18 = healthy. < 1e18 = liquidatable.
     */
    function getHealthFactor(address user) public view returns (uint256) {
        Position storage pos = positions[user];
        if (!pos.isActive) return type(uint256).max;

        uint256 collateralUsdWad = oracle.getWdotValueInUsd(pos.collateralWdot);
        uint256 totalDebt        = pos.debtUsdc + _accrueInterest(pos.debtUsdc, pos.borrowTimestamp);
        uint256 debtUsdWad       = DecimalLib.usdcToWad(totalDebt);

        return DecimalLib.healthFactor(collateralUsdWad, debtUsdWad, LIQ_THRESHOLD_BPS);
    }

    /**
     * @notice Get repayment breakdown for a user.
     * @return principal USDC principal (6dp)
     * @return interest  Accrued interest (6dp)
     * @return total     principal + interest (6dp)
     */
    function getRepaymentAmount(address user) external view returns (
        uint256 principal,
        uint256 interest,
        uint256 total
    ) {
        Position storage pos = positions[user];
        if (!pos.isActive) return (0, 0, 0);
        principal = pos.debtUsdc;
        interest  = _accrueInterest(pos.debtUsdc, pos.borrowTimestamp);
        total     = principal + interest;
    }

    /**
     * @notice Max additional USDC (in WAD) the user could borrow given current collateral.
     */
    function getMaxBorrow(address user) external view returns (uint256) {
        uint256 availableWdot = vault.getAvailableCollateral(user);
        if (availableWdot == 0) return 0;
        uint256 collateralUsdWad = oracle.getWdotValueInUsd(availableWdot);
        return DecimalLib.maxBorrow(collateralUsdWad, COLLATERAL_RATIO_BPS);
    }

    // ─── Internal Helpers ────────────────────────────────────────────────────

    /**
     * @notice Simple interest calculation. Result stays in USDC (6dp).
     */
    function _accrueInterest(uint256 principal, uint256 ts) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - ts;
        return (principal * INTEREST_RATE_BPS * elapsed) / (BPS_BASE * SECONDS_PER_YEAR);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setBridge(address _bridge) external onlyOwner {
        require(_bridge != address(0), "LP: zero bridge");
        bridge = IRemittanceBridge(_bridge);
        emit BridgeUpdated(_bridge);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawFees(address to) external onlyOwner {
        require(to != address(0), "LP: zero address");
        uint256 fees = protocolFeesUsdc;
        protocolFeesUsdc = 0;
        usdc.safeTransfer(to, fees);
    }
}
