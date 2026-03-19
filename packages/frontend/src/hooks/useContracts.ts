import { useChainId } from 'wagmi';
import type { Abi, Address } from 'viem';

import WDOTAbi from '../abis/WDOT.json';
import CollateralVaultAbi from '../abis/CollateralVault.json';
import LendingPoolAbi from '../abis/LendingPool.json';
import RemittanceBridgeAbi from '../abis/RemittanceBridge.json';
import PriceOracleAbi from '../abis/PriceOracle.json';
import MockERC20Abi from '../abis/MockERC20.json';
import addresses from '../abis/addresses.json';

export interface ContractConfig {
  address: Address;
  abi: Abi;
}

export interface Contracts {
  wdot: ContractConfig;
  vault: ContractConfig;
  pool: ContractConfig;
  bridge: ContractConfig;
  oracle: ContractConfig;
  usdc: ContractConfig;
}

const addressMap = addresses as Record<string, Record<string, string>>;

/**
 * Returns contract config objects { address, abi } for all DotBridge contracts.
 * Network key is resolved from the connected chain ID.
 */
export function useContracts(): Contracts {
  const chainId = useChainId();

  let networkKey: string;
  if (chainId === 420420417 || chainId === 420420421) {
    networkKey = addressMap['polkadotHubTestnet'] ? 'polkadotHubTestnet' : 'westend';
  } else {
    networkKey = addressMap['localhost'] ? 'localhost' : 'hardhat';
  }

  const addrs = addressMap[networkKey] || {};

  return {
    wdot:   { address: addrs.WDOT as Address,             abi: WDOTAbi.abi as Abi },
    vault:  { address: addrs.CollateralVault as Address,   abi: CollateralVaultAbi.abi as Abi },
    pool:   { address: addrs.LendingPool as Address,       abi: LendingPoolAbi.abi as Abi },
    bridge: { address: addrs.RemittanceBridge as Address,  abi: RemittanceBridgeAbi.abi as Abi },
    oracle: { address: addrs.PriceOracle as Address,       abi: PriceOracleAbi.abi as Abi },
    usdc:   { address: addrs.MockUSDC as Address,          abi: MockERC20Abi.abi as Abi },
  };
}
