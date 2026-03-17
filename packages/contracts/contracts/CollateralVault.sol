// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ICollateralVault.sol";

/**
 * @title CollateralVault
 * @notice Custodian for WDOT collateral. Knows nothing about lending logic.
 *
 * @dev RESPONSIBILITIES (single concern):
 *   - Accept WDOT deposits from users
 *   - Track available vs locked WDOT per user
 *   - Lock/release/seize collateral on LendingPool instruction only
 *
 * @dev SECURITY MODEL:
 *   - Only the authorized lendingPool address can call lock/release/seize
 *   - All token transfers use SafeERC20
 *   - ReentrancyGuard on deposit/withdraw/seize
 *   - Checks-Effects-Interactions: state changes BEFORE external calls
 *
 * @dev USER FLOW:
 *   1. User calls wdot.approve(collateralVaultAddress, amount)
 *   2. User calls collateralVault.deposit(amount)
 *   3. LendingPool calls lockCollateral(user, amount) when a loan opens
 *   4. LendingPool calls releaseCollateral(user, amount) when loan is repaid
 *   5. LendingPool calls seizeCollateral(user, amount, recipient) on liquidation
 *   6. User calls withdraw(amount) for unlocked WDOT anytime
 */
contract CollateralVault is ICollateralVault, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────
    IERC20  public immutable wdot;
    address public           lendingPool;

    mapping(address => uint256) private _available;
    mapping(address => uint256) private _locked;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event CollateralLocked(address indexed user, uint256 amount);
    event CollateralReleased(address indexed user, uint256 amount);
    event CollateralSeized(address indexed user, uint256 amount, address indexed recipient);
    event LendingPoolSet(address indexed lendingPool);

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyLendingPool() {
        require(msg.sender == lendingPool, "Vault: caller is not LendingPool");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(
        address initialOwner,
        address wdotAddress
    ) Ownable(initialOwner) {
        require(wdotAddress != address(0), "Vault: zero WDOT address");
        wdot = IERC20(wdotAddress);
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    /// @notice Set the LendingPool address. Only callable by owner.
    function setLendingPool(address _lendingPool) external onlyOwner {
        require(_lendingPool != address(0), "Vault: zero address");
        lendingPool = _lendingPool;
        emit LendingPoolSet(_lendingPool);
    }

    // ─── User Actions ────────────────────────────────────────────────────────

    /**
     * @notice Deposit WDOT as collateral.
     * @dev User must approve this contract for `wdotAmount` WDOT before calling.
     *      CEI: state change BEFORE safeTransferFrom.
     * @param wdotAmount WDOT amount in planks (10 decimals)
     */
    function deposit(uint256 wdotAmount) external nonReentrant {
        require(wdotAmount > 0, "Vault: zero deposit");
        // Effect
        _available[msg.sender] += wdotAmount;
        // Interaction
        wdot.safeTransferFrom(msg.sender, address(this), wdotAmount);
        emit Deposited(msg.sender, wdotAmount);
    }

    /**
     * @notice Withdraw available (unlocked) WDOT collateral.
     * @param wdotAmount WDOT amount in planks (10 decimals)
     */
    function withdraw(uint256 wdotAmount) external nonReentrant {
        require(wdotAmount > 0, "Vault: zero amount");
        require(_available[msg.sender] >= wdotAmount, "Vault: insufficient available collateral");
        // Effect
        _available[msg.sender] -= wdotAmount;
        // Interaction
        wdot.safeTransfer(msg.sender, wdotAmount);
        emit Withdrawn(msg.sender, wdotAmount);
    }

    // ─── LendingPool Actions (onlyLendingPool) ─────────────────────────────

    /**
     * @notice Move `wdotAmount` from user's available → locked bucket.
     *         Called by LendingPool when a borrow position is opened.
     */
    function lockCollateral(address user, uint256 wdotAmount) external onlyLendingPool {
        require(_available[user] >= wdotAmount, "Vault: insufficient available to lock");
        _available[user] -= wdotAmount;
        _locked[user]    += wdotAmount;
        emit CollateralLocked(user, wdotAmount);
    }

    /**
     * @notice Move `wdotAmount` from user's locked → available bucket.
     *         Called by LendingPool when a loan is fully repaid.
     */
    function releaseCollateral(address user, uint256 wdotAmount) external onlyLendingPool {
        require(_locked[user] >= wdotAmount, "Vault: insufficient locked to release");
        _locked[user]    -= wdotAmount;
        _available[user] += wdotAmount;
        emit CollateralReleased(user, wdotAmount);
    }

    /**
     * @notice Seize `wdotAmount` of locked collateral from user and send to recipient.
     *         Called by LendingPool during liquidation.
     * @param recipient Address receiving the seized WDOT (liquidator or protocol)
     */
    function seizeCollateral(
        address user,
        uint256 wdotAmount,
        address recipient
    ) external onlyLendingPool nonReentrant {
        require(_locked[user] >= wdotAmount, "Vault: insufficient locked to seize");
        require(recipient != address(0), "Vault: zero recipient");
        // Effect
        _locked[user] -= wdotAmount;
        // Interaction
        wdot.safeTransfer(recipient, wdotAmount);
        emit CollateralSeized(user, wdotAmount, recipient);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Available (unlocked) WDOT for a user
    function getAvailableCollateral(address user) external view returns (uint256) {
        return _available[user];
    }

    /// @notice Locked WDOT for a user (backing active loans)
    function getLockedCollateral(address user) external view returns (uint256) {
        return _locked[user];
    }

    /// @notice Total WDOT deposited by user (available + locked)
    function getTotalCollateral(address user) external view returns (uint256) {
        return _available[user] + _locked[user];
    }
}
