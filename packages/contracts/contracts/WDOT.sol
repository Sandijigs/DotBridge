// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title WDOT — Wrapped DOT
 * @notice WETH9-style wrapper for native DOT on Polkadot Hub.
 *
 * @dev WHY THIS EXISTS:
 *   On Polkadot Hub, DOT is the native gas token (like ETH on Ethereum).
 *   As of Jan 2026 there is NO official Wrapped DOT ERC-20 precompile.
 *   (See: github.com/polkadot-developers/polkadot-docs/issues/1447)
 *   DotBridge deploys this canonical WDOT to fill that ecosystem gap.
 *
 * @dev DECIMAL CRITICAL NOTE:
 *   DOT uses 10 decimals — NOT 18 like ETH/WETH.
 *   1 DOT = 10_000_000_000 (10^10) planks.
 *   WDOT mirrors this: 10 decimals.
 *   All contracts that interact with WDOT amounts must use
 *   the DECIMAL_FACTOR helpers in LendingPool for safe normalization.
 *
 * @dev USAGE PATTERN:
 *   1. User calls deposit{value: dotAmount}() → receives WDOT 1:1
 *   2. User approve(collateralVault, amount) → CollateralVault can pull WDOT
 *   3. To get DOT back: withdraw(wdotAmount) → burns WDOT, sends native DOT
 */
contract WDOT {
    // ─── Metadata ────────────────────────────────────────────────────────────
    string  public constant name     = "Wrapped DOT";
    string  public constant symbol   = "WDOT";
    uint8   public constant decimals = 10; // DOT: 10 decimals, NOT 18

    // ─── State ───────────────────────────────────────────────────────────────
    mapping(address => uint256)                       public balanceOf;
    mapping(address => mapping(address => uint256))   public allowance;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);
    event Transfer(address indexed src, address indexed dst, uint256 wad);
    event Approval(address indexed src, address indexed guy, uint256 wad);

    // ─── Wrap / Unwrap ───────────────────────────────────────────────────────

    /// @notice Fallback: sending native DOT directly wraps it into WDOT
    receive() external payable {
        deposit();
    }

    /// @notice Wrap native DOT into WDOT (1:1)
    function deposit() public payable {
        require(msg.value > 0, "WDOT: zero deposit");
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    /// @notice Unwrap WDOT back into native DOT (1:1)
    /// @param wad Amount of WDOT to unwrap (in planks, 10 decimals)
    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "WDOT: insufficient balance");
        balanceOf[msg.sender] -= wad;
        (bool ok, ) = payable(msg.sender).call{value: wad}("");
        require(ok, "WDOT: native transfer failed");
        emit Withdrawal(msg.sender, wad);
        emit Transfer(msg.sender, address(0), wad);
    }

    // ─── ERC-20 ──────────────────────────────────────────────────────────────

    /// @notice Total WDOT in circulation equals the DOT locked in this contract
    function totalSupply() external view returns (uint256) {
        return address(this).balance;
    }

    function approve(address guy, uint256 wad) external returns (bool) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) external returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        require(balanceOf[src] >= wad, "WDOT: insufficient balance");

        if (src != msg.sender) {
            uint256 allowed = allowance[src][msg.sender];
            require(allowed >= wad, "WDOT: insufficient allowance");
            if (allowed != type(uint256).max) {
                allowance[src][msg.sender] = allowed - wad;
            }
        }

        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        emit Transfer(src, dst, wad);
        return true;
    }
}
