// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ICollateralVault {
    function deposit(uint256 wdotAmount) external;
    function lockCollateral(address user, uint256 wdotAmount) external;
    function releaseCollateral(address user, uint256 wdotAmount) external;
    function seizeCollateral(address user, uint256 wdotAmount, address recipient) external;
    function getAvailableCollateral(address user) external view returns (uint256);
    function getLockedCollateral(address user) external view returns (uint256);
    function getTotalCollateral(address user) external view returns (uint256);
}
