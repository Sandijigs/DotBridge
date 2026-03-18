import { useState, useCallback } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { useWriteContract, useReadContract, usePublicClient } from 'wagmi';
import { useContracts } from './useContracts';

const DECIMALS = 10;

export function useWrapDOT() {
  const { wdot } = useContracts();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const wrap = useCallback(async (dotAmountStr) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const amount = parseUnits(dotAmountStr, DECIMALS);
      const gasEst = await publicClient.estimateContractGas({
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
  }, [wdot, publicClient, writeContractAsync]);

  return { wrap, isLoading, txHash, error };
}

export function useUnwrapWDOT() {
  const { wdot } = useContracts();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const unwrap = useCallback(async (wdotAmountStr) => {
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
    } catch (err) {
      setError(err.shortMessage || err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [wdot, writeContractAsync]);

  return { unwrap, isLoading, txHash, error };
}

export function useWDOTBalance(address) {
  const { wdot } = useContracts();

  const { data: raw, refetch } = useReadContract({
    address: wdot.address,
    abi: wdot.abi,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: !!address },
  });

  const value = raw ?? 0n;
  const formatted = formatUnits(value, DECIMALS) + ' WDOT';

  return { raw: value, formatted, refetch };
}
