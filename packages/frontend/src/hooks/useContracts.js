import { useChainId } from 'wagmi';

import WDOTAbi from '../abis/WDOT.json';
import CollateralVaultAbi from '../abis/CollateralVault.json';
import LendingPoolAbi from '../abis/LendingPool.json';
import RemittanceBridgeAbi from '../abis/RemittanceBridge.json';
import PriceOracleAbi from '../abis/PriceOracle.json';
import MockERC20Abi from '../abis/MockERC20.json';
import addresses from '../abis/addresses.json';

/**
 * Returns contract config objects { address, abi } for all DotBridge contracts.
 * Network key is resolved from the connected chain ID.
 */
export function useContracts() {
  const chainId = useChainId();

  // Map chain IDs to address keys in addresses.json
  let networkKey;
  if (chainId === 420420417 || chainId === 420420421) {
    // Check which key exists in addresses.json
    networkKey = addresses['polkadotHubTestnet'] ? 'polkadotHubTestnet' : 'westend';
  } else {
    networkKey = addresses['localhost'] ? 'localhost' : 'hardhat';
  }

  const addrs = addresses[networkKey] || {};

  return {
    wdot:   { address: addrs.WDOT,             abi: WDOTAbi.abi },
    vault:  { address: addrs.CollateralVault,   abi: CollateralVaultAbi.abi },
    pool:   { address: addrs.LendingPool,       abi: LendingPoolAbi.abi },
    bridge: { address: addrs.RemittanceBridge,   abi: RemittanceBridgeAbi.abi },
    oracle: { address: addrs.PriceOracle,       abi: PriceOracleAbi.abi },
    usdc:   { address: addrs.MockUSDC,          abi: MockERC20Abi.abi },
  };
}
