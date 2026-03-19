import { useState, useCallback } from 'react';
import { parseUnits, formatUnits, type Address } from 'viem';
import { useWriteContract, useReadContract, usePublicClient } from 'wagmi';
import { useContracts } from './useContracts';

const DECIMALS = 10;

export function useWrapDOT() {
  const { wdot } = useContracts();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wrap = useCallback(async (dotAmountStr: string) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const amount = parseUnits(dotAmountStr, DECIMALS);
      const gasEst = await publicClient!.estimateContractGas({
        address: wdot.address,
        abi: wdot.abi,
        functionName: 'deposit',
        value: amount,
      });
      const hash = await writeContractAsync({
        address: wdot.address,
        abi: wdot.abi,
        functionName: 'deposit',
        value: amount,
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
  }, [wdot, publicClient, writeContractAsync]);

  return { wrap, isLoading, txHash, error };
}

export function useUnwrapWDOT() {
  const { wdot } = useContracts();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unwrap = useCallback(async (wdotAmountStr: string) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const amount = parseUnits(wdotAmountStr, DECIMALS);
      const hash = await writeContractAsync({
        address: wdot.address,
        abi: wdot.abi,
        functionName: 'withdraw',
        args: [amount],
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
  }, [wdot, writeContractAsync]);

  return { unwrap, isLoading, txHash, error };
}

export function useWDOTBalance(address: Address | undefined) {
  const { wdot } = useContracts();

  const { data: raw, refetch } = useReadContract({
    address: wdot.address,
    abi: wdot.abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const value = (raw as bigint) ?? 0n;
  const formatted = formatUnits(value, DECIMALS) + ' WDOT';

  return { raw: value, formatted, refetch };
}
