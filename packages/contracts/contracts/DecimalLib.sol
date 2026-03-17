// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title DecimalLib
 * @notice Decimal normalization utilities for DotBridge.
 *
 * @dev Token decimal map on Polkadot Hub:
 *      ┌─────────┬──────────┬────────────────────────────────────────┐
 *      │ Token   │ Decimals │ Scale factor to 18dp internal precision│
 *      ├─────────┼──────────┼────────────────────────────────────────┤
 *      │ WDOT    │    10    │ × 10^8  = × 100_000_000                │
 *      │ USDC    │     6    │ × 10^12 = × 1_000_000_000_000          │
 *      │ USDT    │     6    │ × 10^12 = × 1_000_000_000_000          │
 *      └─────────┴──────────┴────────────────────────────────────────┘
 *
 * All LendingPool arithmetic uses 18-decimal internal precision (WAD).
 * Never compare raw WDOT amounts to raw USDC amounts — normalize first.
 */
library DecimalLib {
    uint256 internal constant WAD = 1e18;           // 18-decimal precision
    uint256 internal constant DOT_DECIMALS  = 10;   // native DOT / WDOT
    uint256 internal constant USDC_DECIMALS = 6;    // USDC / USDT on Hub

    /// @dev Scale factor: WDOT (10dp) → WAD (18dp)
    uint256 internal constant WDOT_TO_WAD  = 1e8;   // 10^(18-10)
    /// @dev Scale factor: USDC (6dp)  → WAD (18dp)
    uint256 internal constant USDC_TO_WAD  = 1e12;  // 10^(18-6)

    /// @notice Normalise a WDOT amount to 18-decimal WAD
    function wdotToWad(uint256 wdotAmount) internal pure returns (uint256) {
        return wdotAmount * WDOT_TO_WAD;
    }

    /// @notice Normalise a USDC amount to 18-decimal WAD
    function usdcToWad(uint256 usdcAmount) internal pure returns (uint256) {
        return usdcAmount * USDC_TO_WAD;
    }

    /// @notice Convert WAD back to WDOT decimals (truncates)
    function wadToWdot(uint256 wadAmount) internal pure returns (uint256) {
        return wadAmount / WDOT_TO_WAD;
    }

    /// @notice Convert WAD back to USDC decimals (truncates)
    function wadToUsdc(uint256 wadAmount) internal pure returns (uint256) {
        return wadAmount / USDC_TO_WAD;
    }

    /**
     * @notice Compute USD value of a WDOT amount.
     * @param wdotAmount  Raw WDOT balance (10 decimals)
     * @param dotPriceWad DOT/USD price in WAD (18 decimals) from PriceOracle
     * @return usdValueWad USD value in WAD (18 decimals)
     */
    function wdotValueInUsd(
        uint256 wdotAmount,
        uint256 dotPriceWad
    ) internal pure returns (uint256 usdValueWad) {
        // Normalise WDOT to 18dp then multiply by price (already 18dp)
        // Result is 36dp → divide by WAD to get 18dp
        usdValueWad = (wdotToWad(wdotAmount) * dotPriceWad) / WAD;
    }

    /**
     * @notice Compute max borrowable USDC (WAD) given collateral and ratio.
     * @param collateralUsdWad Collateral value in USD (WAD)
     * @param ratioBps         Collateral ratio in basis points (e.g. 15000 = 150%)
     * @return maxBorrowUsdWad Maximum borrowable amount in USD (WAD)
     */
    function maxBorrow(
        uint256 collateralUsdWad,
        uint256 ratioBps
    ) internal pure returns (uint256 maxBorrowUsdWad) {
        // maxBorrow = collateralUsd * 10000 / ratioBps
        maxBorrowUsdWad = (collateralUsdWad * 10_000) / ratioBps;
    }

    /**
     * @notice Compute health factor (WAD) for a position.
     * @dev    healthFactor = (collateralValueUsd * LIQ_THRESHOLD_BPS) / (debt * 10000)
     *         healthFactor >= 1 WAD = safe. < 1 WAD = liquidatable.
     * @param collateralUsdWad  Collateral value in USD (WAD)
     * @param debtUsdWad        Debt value in USD (WAD)
     * @param liqThresholdBps   Liquidation threshold in BPS (e.g. 13000 = 130%)
     */
    function healthFactor(
        uint256 collateralUsdWad,
        uint256 debtUsdWad,
        uint256 liqThresholdBps
    ) internal pure returns (uint256) {
        if (debtUsdWad == 0) return type(uint256).max; // no debt = infinite health
        return (collateralUsdWad * liqThresholdBps * WAD) / (debtUsdWad * 10_000);
    }
}
