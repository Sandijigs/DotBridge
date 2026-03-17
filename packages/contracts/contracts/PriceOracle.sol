// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import {DecimalLib} from "./DecimalLib.sol";

/**
 * @title PriceOracle
 * @notice Returns the DOT/USD price used by LendingPool for collateral valuation.
 *
 * @dev TWO MODES:
 *   - Mock mode (useMock = true):  Owner sets price manually. Used on testnet.
 *   - Live mode (useMock = false): Reads from a Chainlink AggregatorV3 feed.
 *
 * @dev DECIMAL OUTPUT:
 *   getDotPriceWad() always returns price in WAD (18 decimals).
 *   Example: DOT at $6.00 → returns 6e18.
 *
 * @dev UPGRADE PATH:
 *   Deploy with useMock=true for testnet demo.
 *   Call setChainlinkFeed(address) + setMode(false) before mainnet.
 *   LendingPool only calls getDotPriceWad() — swap is transparent.
 */
interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80  roundId,
            int256  answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80  answeredInRound
        );
    function decimals() external view returns (uint8);
}

contract PriceOracle is Ownable {
    // ─── State ───────────────────────────────────────────────────────────────
    bool    public useMock = true;
    int256  public mockPriceUsd;          // WAD format, e.g. 6e18 = $6.00
    address public chainlinkFeed;
    uint256 public stalenessThreshold = 3600; // 1 hour default

    // ─── Events ──────────────────────────────────────────────────────────────
    event MockPriceSet(int256 price, address setBy);
    event ModeChanged(bool useMock);
    event FeedUpdated(address feed);

    // ─── Constructor ─────────────────────────────────────────────────────────
    /**
     * @param initialOwner   Address that owns this oracle.
     * @param initialMockPrice  Initial DOT/USD price in WAD (e.g. 6e18 = $6.00).
     */
    constructor(
        address initialOwner,
        int256 initialMockPrice
    ) Ownable(initialOwner) {
        require(initialMockPrice > 0, "PriceOracle: price must be positive");
        mockPriceUsd = initialMockPrice;
        emit MockPriceSet(initialMockPrice, initialOwner);
    }

    // ─── Price Read ──────────────────────────────────────────────────────────

    /**
     * @notice Returns the current DOT/USD price in WAD (18 decimals).
     * @return priceWad DOT price in USD, scaled to 18 decimals.
     *         e.g. $6.00 = 6_000_000_000_000_000_000
     */
    function getDotPriceWad() public view returns (uint256 priceWad) {
        if (useMock) {
            return uint256(mockPriceUsd);
        }
        return _getLivePrice();
    }

    /**
     * @notice Read DOT/USD from Chainlink feed, scale to WAD.
     */
    function _getLivePrice() internal view returns (uint256) {
        require(chainlinkFeed != address(0), "PriceOracle: feed not set");

        AggregatorV3Interface feed = AggregatorV3Interface(chainlinkFeed);
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        require(answer > 0, "PriceOracle: invalid price");
        require(
            block.timestamp - updatedAt <= stalenessThreshold,
            "PriceOracle: stale price"
        );

        // Scale Chainlink answer (typically 8dp) up to WAD (18dp)
        uint8 feedDecimals = feed.decimals();
        return uint256(answer) * (10 ** (18 - feedDecimals));
    }

    /**
     * @notice Compute USD value of a WDOT amount using current DOT price.
     * @param wdotAmount Amount of WDOT in planks (10 decimals)
     * @return USD value in WAD (18 decimals)
     */
    function getWdotValueInUsd(uint256 wdotAmount) external view returns (uint256) {
        return DecimalLib.wdotValueInUsd(wdotAmount, getDotPriceWad());
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// @notice Set mock DOT/USD price in WAD (18 decimal precision)
    function setMockPrice(int256 priceWad) external onlyOwner {
        require(priceWad > 0, "PriceOracle: price must be positive");
        mockPriceUsd = priceWad;
        emit MockPriceSet(priceWad, msg.sender);
    }

    /// @notice Toggle between mock and live Chainlink mode
    function setMode(bool _useMock) external onlyOwner {
        useMock = _useMock;
        emit ModeChanged(_useMock);
    }

    /// @notice Set the Chainlink price feed address
    function setChainlinkFeed(address _feed) external onlyOwner {
        require(_feed != address(0), "PriceOracle: zero address");
        chainlinkFeed = _feed;
        emit FeedUpdated(_feed);
    }

    /// @notice Set the staleness threshold for Chainlink data
    function setStalenessThreshold(uint256 _threshold) external onlyOwner {
        stalenessThreshold = _threshold;
    }
}
