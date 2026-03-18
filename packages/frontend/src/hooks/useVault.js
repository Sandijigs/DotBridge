import { useState, useCallback } from 'react';
import { parseUnits, formatUnits } from 'viem';
import { useWriteContract, useReadContract } from 'wagmi';
import { useContracts } from './useContracts';

const DECIMALS = 10;

export function useDepositCollateral() {
  const { wdot, vault } = useContracts();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const deposit = useCallback(async (wdotAmountStr) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const amount = parseUnits(wdotAmountStr, DECIMALS);

      setStep('approving');
      await writeContractAsync({
        address: wdot.address,
        abi: wdot.abi,
        functionName: 'approve',
        args: [vault.address, amount],
      });

      setStep('depositing');
      const hash = await writeContractAsync({
        address: vault.address,
        abi: vault.abi,
        functionName: 'deposit',
        args: [amount],
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
  }, [wdot, vault, writeContractAsync]);

  return { deposit, step, isLoading, txHash, error };
}

export function useWithdrawCollateral() {
  const { vault } = useContracts();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const withdraw = useCallback(async (wdotAmountStr) => {
    setIsLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const amount = parseUnits(wdotAmountStr, DECIMALS);
      const hash = await writeContractAsync({
        address: vault.address,
        abi: vault.abi,
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
  }, [vault, writeContractAsync]);

  return { withdraw, isLoading, txHash, error };
}

export function useCollateralBalances(address) {
  const { vault } = useContracts();

  const { data: availableRaw, refetch: refetchAvailable } = useReadContract({
    address: vault.address,
    abi: vault.abi,
    functionName: 'getAvailableCollateral',
    args: [address],
    query: { enabled: !!address },
  });

  const { data: lockedRaw, refetch: refetchLocked } = useReadContract({
    address: vault.address,
    abi: vault.abi,
    functionName: 'getLockedCollateral',
    args: [address],
    query: { enabled: !!address },
  });

  const available = availableRaw ?? 0n;
  const locked = lockedRaw ?? 0n;

  const refetch = useCallback(() => {
    refetchAvailable();
    refetchLocked();
  }, [refetchAvailable, refetchLocked]);

  return {
    available: {
      raw: available,
      formatted: formatUnits(available, DECIMALS) + ' WDOT',
    },
    locked: {
      raw: locked,
      formatted: formatUnits(locked, DECIMALS) + ' WDOT',
    },
    refetch,
  };
}
