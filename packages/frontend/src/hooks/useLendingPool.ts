import { useState, useCallback } from 'react';
import { parseUnits, formatUnits, type Address } from 'viem';
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
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const borrow = useCallback(async (
    usdcAmountStr: string,
    destChainId?: string | number,
    recipientAddr?: string,
  ) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const usdcAmount = parseUnits(usdcAmountStr, USDC_DECIMALS);
      const chainId = BigInt(destChainId ?? 0);
      const recipient = recipientAddr || '0x0000000000000000000000000000000000000000';

      const gasEst = await publicClient!.estimateContractGas({
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
        gas: (gasEst * 120n) / 100n,
      });
      setTxHash(hash);
      return hash;
    } catch (err: unknown) {
      const msg = (err as { shortMessage?: string; message?: string }).shortMessage
        || (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [pool, publicClient, writeContractAsync]);

  return { borrow, isLoading, txHash, error };
}

// ─── Repay ─────────────────────────────────────────────────────

type RepayStep = 'idle' | 'approving' | 'repaying' | 'done';

export function useRepay() {
  const { pool, usdc } = useContracts();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<RepayStep>('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repay = useCallback(async (totalAmount: bigint) => {
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
    } catch (err: unknown) {
      const msg = (err as { shortMessage?: string; message?: string }).shortMessage
        || (err as Error).message;
      setError(msg);
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
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const liquidate = useCallback(async (targetAddress: Address) => {
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
    } catch (err: unknown) {
      const msg = (err as { shortMessage?: string; message?: string }).shortMessage
        || (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [pool, writeContractAsync]);

  return { liquidate, isLoading, txHash, error };
}

// ─── Position ──────────────────────────────────────────────────

export function usePosition(address: Address | undefined) {
  const { pool } = useContracts();

  const { data, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'positions',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const result = data as [bigint, bigint, bigint, boolean] | undefined;
  const collateralWdot = result?.[0] ?? 0n;
  const debtUsdc = result?.[1] ?? 0n;
  const borrowTimestamp = result?.[2] ?? 0n;
  const isActive = result?.[3] ?? false;

  return { isActive, collateralWdot, debtUsdc, borrowTimestamp, refetch };
}

// ─── Health Factor ─────────────────────────────────────────────

const MAX_UINT256 = 2n ** 256n - 1n;
const WAD = 10n ** 18n;

export type HealthStatus = 'none' | 'safe' | 'caution' | 'danger';

export function useHealthFactor(address: Address | undefined) {
  const { pool } = useContracts();

  const { data: raw, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'getHealthFactor',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const value = (raw as bigint) ?? MAX_UINT256;

  let display: string;
  let status: HealthStatus;
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

export function useMaxBorrow(address: Address | undefined) {
  const { pool } = useContracts();

  const { data: raw, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'getMaxBorrow',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const wadValue = (raw as bigint) ?? 0n;
  const maxUsdc = wadValue / USDC_TO_WAD;
  const display = formatUnits(maxUsdc, USDC_DECIMALS) + ' USDC';

  return { raw: wadValue, maxUsdc, display, refetch };
}

// ─── Repayment Amount ──────────────────────────────────────────

export function useRepaymentAmount(address: Address | undefined) {
  const { pool } = useContracts();

  const { data, refetch } = useReadContract({
    address: pool.address,
    abi: pool.abi,
    functionName: 'getRepaymentAmount',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const result = data as [bigint, bigint, bigint] | undefined;
  const principal = result?.[0] ?? 0n;
  const interest = result?.[1] ?? 0n;
  const total = result?.[2] ?? 0n;

  return {
    principal: formatUnits(principal, USDC_DECIMALS),
    interest: formatUnits(interest, USDC_DECIMALS),
    total: formatUnits(total, USDC_DECIMALS),
    totalRaw: total,
    refetch,
  };
}
