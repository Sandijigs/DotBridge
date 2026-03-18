import { useState, useCallback } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { useWriteContract, useReadContract, usePublicClient } from 'wagmi';
import { useContracts } from './useContracts';

const USDC_DECIMALS = 6;
const USDC_TO_WAD = 1_000_000_000_000n; // 1e12

// ─── Borrow ────────────────────────────────────────────────────

export function useBorrow() {
  const { pool } = useContracts();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const borrow = useCallback(async (usdcAmountStr, destChainId, recipientAddr) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const usdcAmount = parseUnits(usdcAmountStr, USDC_DECIMALS);
      const chainId = BigInt(destChainId ?? 0);
      const recipient = recipientAddr || '0x0000000000000000000000000000000000000000';

      const gasEst = await publicClient.estimateContractGas({
        address: pool.address,
        abi: pool.abi,
        functionName: 'borrow',
        args: [usdcAmount, chainId, recipient],
      });

      const hash = await writeContractAsync({
        address: pool.address,
        abi: pool.abi,
        functionName: 'borrow',
        args: [usdcAmount, chainId, recipient],
        gas: gasEst * 120n / 100n,
      });
      setTxHash(hash);
      return hash;
    } catch (err) {
      setError(err.shortMessage || err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [pool, publicClient, writeContractAsync]);

  return { borrow, isLoading, txHash, error };
}

// ─── Repay ─────────────────────────────────────────────────────

export function useRepay() {
  const { pool, usdc } = useContracts();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const repay = useCallback(async (totalAmount) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      setStep('approving');
      await writeContractAsync({
        address: usdc.address,
        abi: usdc.abi,
        functionName: 'approve',
        args: [pool.address, totalAmount],
      });

      setStep('repaying');
      const hash = await writeContractAsync({
        address: pool.address,
        abi: pool.abi,
        functionName: 'repay',
      });

      setTxHash(hash);
      setStep('done');
      return hash;
    } catch (err) {
      setError(err.shortMessage || err.message);
      setStep('idle');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [pool, usdc, writeContractAsync]);

  return { repay, step, isLoading, txHash, error };
}

// ─── Liquidate ─────────────────────────────────────────────────

export function useLiquidate() {
  const { pool } = useContracts();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const liquidate = useCallback(async (targetAddress) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: pool.address,
        abi: pool.abi,
        functionName: 'liquidate',
        args: [targetAddress],
      });
      setTxHash(hash);
      return hash;
    } catch (err) {
      setError(err.shortMessage || err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [pool, writeContractAsync]);

  return { liquidate, isLoading, txHash, error };
}

// ─── Position ──────────────────────────────────────────────────

export function usePosition(address) {
  const { pool } = useContracts();

  const { data, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'positions',
    args: [address],
    query: { enabled: !!address },
  });

  // positions returns [collateralWdot, debtUsdc, borrowTimestamp, isActive]
  const collateralWdot = data?.[0] ?? 0n;
  const debtUsdc = data?.[1] ?? 0n;
  const borrowTimestamp = data?.[2] ?? 0n;
  const isActive = data?.[3] ?? false;

  return { isActive, collateralWdot, debtUsdc, borrowTimestamp, refetch };
}

// ─── Health Factor ─────────────────────────────────────────────

const MAX_UINT256 = 2n ** 256n - 1n;
const WAD = 10n ** 18n;

export function useHealthFactor(address) {
  const { pool } = useContracts();

  const { data: raw, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'getHealthFactor',
    args: [address],
    query: { enabled: !!address },
  });

  const value = raw ?? MAX_UINT256;

  let display, status;
  if (value >= MAX_UINT256) {
    display = '--';
    status = 'none';
  } else {
    display = (Number(value) / 1e18).toFixed(2);
    if (value >= (WAD * 15n) / 10n) {
      status = 'safe';
    } else if (value >= (WAD * 13n) / 10n) {
      status = 'caution';
    } else {
      status = 'danger';
    }
  }

  return { raw: value, display, status, refetch };
}

// ─── Max Borrow ────────────────────────────────────────────────

export function useMaxBorrow(address) {
  const { pool } = useContracts();

  const { data: raw, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'getMaxBorrow',
    args: [address],
    query: { enabled: !!address },
  });

  const wadValue = raw ?? 0n;
  const maxUsdc = wadValue / USDC_TO_WAD;
  const display = formatUnits(maxUsdc, USDC_DECIMALS) + ' USDC';

  return { raw: wadValue, maxUsdc, display, refetch };
}

// ─── Repayment Amount ──────────────────────────────────────────

export function useRepaymentAmount(address) {
  const { pool } = useContracts();

  const { data, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'getRepaymentAmount',
    args: [address],
    query: { enabled: !!address },
  });

  const principal = data?.[0] ?? 0n;
  const interest = data?.[1] ?? 0n;
  const total = data?.[2] ?? 0n;

  return {
    principal: formatUnits(principal, USDC_DECIMALS),
    interest: formatUnits(interest, USDC_DECIMALS),
    total: formatUnits(total, USDC_DECIMALS),
    totalRaw: total,
    refetch,
  };
}
