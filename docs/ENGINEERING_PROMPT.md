# DotBridge — Master Engineering Prompt
## Feature-by-Feature Build Guide for AI-Assisted Development

> **How to use this document**
> Each Feature is a self-contained unit. Complete it fully, run its test gate,
> confirm all tests pass, then move to the next feature. Never skip ahead.
> Paste the relevant Feature section into your AI coding assistant verbatim.
> The context block at the top of each feature carries forward everything the
> assistant needs — no re-explaining required.

---

## Project Overview

**DotBridge** is a DeFi + remittance protocol on Polkadot Hub (EVM track).
Users deposit WDOT (Wrapped DOT) as collateral, borrow USDC against it,
and optionally send the borrowed USDC cross-chain to any recipient via Hyperbridge.

**Stack**
- Solidity 0.8.27 (EVM/REVM track — standard solc, no resolc needed)
- Hardhat + OpenZeppelin 5.x
- React + Wagmi v2 + RainbowKit + Viem
- Hyperbridge Token Gateway (mock mode → live on testnet)
- Network: Polkadot Hub Testnet (Westend Asset Hub, Chain ID: 420420421)

**Monorepo layout**
```
dotbridge/
  packages/
    contracts/
      contracts/
        WDOT.sol               ← Feature 1
        DecimalLib.sol         ← Feature 2 (library)
        PriceOracle.sol        ← Feature 2
        CollateralVault.sol    ← Feature 3
        LendingPool.sol        ← Feature 4
        RemittanceBridge.sol   ← Feature 5
        interfaces/
          ICollateralVault.sol
          ITokenGateway.sol
        test/
          MockERC20.sol        ← testnet helper
      test/
        01_WDOT.test.js        ← Feature 1 gate
        02_PriceOracle.test.js ← Feature 2 gate
        03_CollateralVault.test.js ← Feature 3 gate
        04_LendingPool.test.js ← Feature 4 gate
        05_RemittanceBridge.test.js ← Feature 5 gate
        06_Integration.test.js ← Feature 6 gate
      scripts/
        deploy.js
      hardhat.config.js
    frontend/
      src/
        constants/chains.js
        abis/                  ← auto-populated by deploy script
        contexts/Web3Context.jsx
        hooks/
        components/
```

---

## Critical Global Rules (apply to every feature)

### R1 — Decimal precision
DOT / WDOT = **10 decimals** (1 DOT = 10_000_000_000 planck).
USDC = **6 decimals**.
All arithmetic inside LendingPool uses **18-decimal WAD internal precision**
via DecimalLib. Never compare raw WDOT amounts to raw USDC amounts.
Use `DecimalLib.wdotToWad()`, `DecimalLib.usdcToWad()` before any arithmetic.

### R2 — Solidity version + EVM target
Pragma: `^0.8.27`. evmVersion: `paris` in hardhat.config.
Reason: newer EVM versions contain opcodes (PUSH0, etc.) unsupported in
PolkaVM. Paris is the safe target for Polkadot Hub REVM.

### R3 — Contract dependency direction
```
User → LendingPool → CollateralVault   (lock/release/seize)
User → LendingPool → RemittanceBridge  (sendRemittance)
User → CollateralVault                 (deposit/withdraw)
LendingPool → PriceOracle              (getDotPriceWad)
```
No contract calls upward in this graph. One-directional only.

### R4 — Access control pattern
CollateralVault and RemittanceBridge expose restricted functions
(`lockCollateral`, `seizeCollateral`, `sendRemittance`) callable ONLY by
the LendingPool address. Set via `setLendingPool()` after deploy.
Both use `onlyLendingPool` modifier — not Ownable for this guard.

### R5 — Mock mode for everything untestable on testnet
- PriceOracle: `useMock = true`, owner sets price via `setMockPrice()`
- RemittanceBridge: `hyperbridgeGateway = address(0)` → simulates cross-chain
  by doing a local USDC transfer to recipient
- MockERC20: deployed instead of USDC precompile on testnet

### R6 — Test-first gate system
Every feature has a numbered test file. All tests in that file must pass
before the next feature is started. Run with:
`npx hardhat test test/0N_FeatureName.test.js`
The integration test (06) must be run last and tests the full flow.

### R7 — Security checklist (apply to every contract function)
- [ ] Checks-Effects-Interactions (CEI) — state changes before external calls
- [ ] ReentrancyGuard on all payable + token-transfer functions
- [ ] SafeERC20 for all ERC-20 transfers (handles non-standard tokens)
- [ ] No hardcoded gas limits on external calls
- [ ] Events emitted for every state change
- [ ] require() with descriptive messages on all inputs

### R8 — Gas on Polkadot Hub
Gas is dynamic (fee multiplier changes per block). Always add 20% buffer
in frontend tx calls. Never hardcode gas limits. Use `gasMultiplier: 1.2`
in hardhat.config. Use `estimateGas()` + 1.2× in frontend.

---

## Feature 1 — WDOT (Wrapped DOT)

### Context
Polkadot Hub has no official Wrapped DOT ERC-20 (open GitHub issue #1447).
We ship our own WDOT.sol using the WETH9 pattern so DOT can be used as an
ERC-20 in CollateralVault. This is a standalone contract with zero dependencies.

### What to build
File: `packages/contracts/contracts/WDOT.sol`

```
WDOT contract
├── State
│   ├── name: "Wrapped DOT"
│   ├── symbol: "WDOT"
│   ├── decimals: 10   ← MUST be 10, not 18
│   ├── balanceOf: mapping(address => uint256)
│   └── allowance: mapping(address => mapping(address => uint256))
├── Events: Deposit, Withdrawal, Transfer, Approval
├── receive() external payable → calls deposit()
├── deposit() public payable
│   └── balanceOf[msg.sender] += msg.value; emit Deposit + Transfer(0x0 → sender)
├── withdraw(uint256 wad)
│   └── burn WDOT → send native DOT via .call{value: wad}(""); emit Withdrawal + Transfer(sender → 0x0)
├── totalSupply() → returns address(this).balance
├── approve(address, uint256) → standard
├── transfer(address, uint256) → calls transferFrom
└── transferFrom(address, address, uint256)
    └── respects MaxUint256 allowance (no decrease)
```

### Acceptance criteria
- [ ] `decimals()` returns exactly `10`
- [ ] `deposit()` with 5 DOT mints exactly 5e10 WDOT (planck precision)
- [ ] `withdraw(5e10)` burns WDOT and returns exactly 5 DOT to caller
- [ ] `totalSupply()` always equals `address(this).balance`
- [ ] `transferFrom` does NOT decrement allowance when it equals `type(uint256).max`
- [ ] All events emit correctly
- [ ] Zero-value deposit reverts

### Test gate
`npx hardhat test test/01_WDOT.test.js` — all tests must pass.

### Common pitfalls
- Using `transfer()` instead of `.call{value}("")` for native sends → hits 2300 gas limit on Hub
- Setting decimals to 18 instead of 10 → silently breaks all downstream math
- Missing `receive()` fallback → plain DOT sends fail silently

---

## Feature 2 — DecimalLib + PriceOracle

### Context
DecimalLib is a pure library — no deployment, no state. It is `import`ed by
LendingPool and PriceOracle. PriceOracle starts in mock mode (owner-set price)
and is designed to swap to a Chainlink feed with zero changes to LendingPool.

### What to build

**File: `packages/contracts/contracts/DecimalLib.sol`**
```
library DecimalLib
├── WAD = 1e18
├── WDOT_TO_WAD = 1e8   ← scale 10dp → 18dp
├── USDC_TO_WAD = 1e12  ← scale 6dp  → 18dp
├── wdotToWad(uint256 wdotAmount) → wdotAmount * 1e8
├── usdcToWad(uint256 usdcAmount) → usdcAmount * 1e12
├── wadToWdot(uint256 wadAmount)  → wadAmount / 1e8
├── wadToUsdc(uint256 wadAmount)  → wadAmount / 1e12
├── wdotValueInUsd(wdotAmount, dotPriceWad) → (wdotToWad(wdotAmount) * dotPriceWad) / WAD
├── maxBorrow(collateralUsdWad, ratioBps) → (collateralUsdWad * 10000) / ratioBps
└── healthFactor(collateralUsdWad, debtUsdWad, liqThresholdBps)
    └── if debtUsdWad == 0: return type(uint256).max
        else: (collateralUsdWad * liqThresholdBps * WAD) / (debtUsdWad * 10000)
```

**File: `packages/contracts/contracts/PriceOracle.sol`**
```
contract PriceOracle (Ownable)
├── State: useMock, mockPriceUsd, chainlinkFeed, stalenessThreshold
├── constructor(owner, initialMockPrice)
├── getDotPriceWad() → returns price in WAD
│   ├── if useMock: return uint256(mockPriceUsd)
│   └── else: _getLivePrice() via AggregatorV3Interface
├── getWdotValueInUsd(wdotAmount) → DecimalLib.wdotValueInUsd(wdotAmount, getDotPriceWad())
├── setMockPrice(int256 priceWad) onlyOwner
├── setMode(bool useMock) onlyOwner
├── setChainlinkFeed(address) onlyOwner
└── setStalenessThreshold(uint256 secs) onlyOwner
```

### Key math verification
At DOT = $6.00 (6e18 WAD):
- `wdotValueInUsd(DOT(10))` = `(10e10 * 1e8 * 6e18) / 1e18` = `60e18` ($60 WAD) ✓
- `maxBorrow(60e18, 15000)` = `(60e18 * 10000) / 15000` = `40e18` ($40 WAD) ✓
- `healthFactor(60e18, 40e18, 13000)` = `(60e18 * 13000 * 1e18) / (40e18 * 10000)` = `1.95e18` (healthy) ✓

### Acceptance criteria
- [ ] `wdotToWad(DOT(10))` = `10e18` exactly
- [ ] `usdcToWad(USDC(100))` = `100e18` exactly
- [ ] `getDotPriceWad()` returns WAD-precision price
- [ ] `getWdotValueInUsd(DOT(10))` = `$60` in WAD at $6 price
- [ ] `setMockPrice` restricted to owner
- [ ] Price can be swapped to live Chainlink with `setMode(false)` + `setChainlinkFeed(addr)`

### Test gate
`npx hardhat test test/02_PriceOracle.test.js` — all tests must pass.

---

## Feature 3 — CollateralVault

### Context
CollateralVault holds WDOT (ERC-20) as collateral. It has no knowledge of
interest rates, borrow limits, or any lending logic. It ONLY tracks available
vs locked balances and enforces that only LendingPool can move funds between
those states. Users interact directly for deposit/withdraw.

### What to build
File: `packages/contracts/contracts/CollateralVault.sol`

```
contract CollateralVault (ICollateralVault, ReentrancyGuard, Ownable)
├── State
│   ├── wdot: IERC20 (immutable)
│   ├── lendingPool: address (set post-deploy)
│   ├── _available: mapping(address => uint256)  ← unlocked WDOT
│   └── _locked:    mapping(address => uint256)  ← in active loan
├── Events: Deposited, Withdrawn, CollateralLocked, CollateralReleased, CollateralSeized
├── modifier onlyLendingPool()
│
├── deposit(uint256 wdotAmount) nonReentrant
│   ├── require(wdotAmount > 0)
│   ├── _available[msg.sender] += wdotAmount
│   └── wdot.safeTransferFrom(msg.sender, address(this), wdotAmount)
│
├── withdraw(uint256 wdotAmount) nonReentrant
│   ├── require(wdotAmount > 0)
│   ├── require(_available[msg.sender] >= wdotAmount, "insufficient available")
│   ├── _available[msg.sender] -= wdotAmount
│   └── wdot.safeTransfer(msg.sender, wdotAmount)
│
├── lockCollateral(user, wdotAmount) onlyLendingPool
│   ├── require(_available[user] >= wdotAmount)
│   ├── _available[user] -= wdotAmount
│   └── _locked[user]    += wdotAmount
│
├── releaseCollateral(user, wdotAmount) onlyLendingPool
│   ├── require(_locked[user] >= wdotAmount)
│   ├── _locked[user]    -= wdotAmount
│   └── _available[user] += wdotAmount
│
├── seizeCollateral(user, wdotAmount, recipient) onlyLendingPool nonReentrant
│   ├── require(_locked[user] >= wdotAmount)
│   ├── require(recipient != address(0))
│   ├── _locked[user] -= wdotAmount
│   └── wdot.safeTransfer(recipient, wdotAmount)
│
├── getAvailableCollateral(user) view → _available[user]
├── getLockedCollateral(user) view    → _locked[user]
├── getTotalCollateral(user) view     → _available[user] + _locked[user]
└── setLendingPool(address) onlyOwner ← call once after LendingPool is deployed
```

### Acceptance criteria
- [ ] `deposit()` requires prior `wdot.approve(vault, amount)`
- [ ] `withdraw()` only moves available (not locked) funds
- [ ] `lockCollateral()` reverts if caller is not LendingPool
- [ ] `seizeCollateral()` sends WDOT directly to `recipient` (not to LendingPool)
- [ ] Cannot withdraw locked collateral (fails with "insufficient available")
- [ ] `getTotalCollateral()` = available + locked at all times
- [ ] setLendingPool reverts on zero address

### Test gate
File: `packages/contracts/test/03_CollateralVault.test.js`
`npx hardhat test test/03_CollateralVault.test.js` — all tests must pass.

**Tests to write:**
```javascript
describe('Feature 3 — CollateralVault', () => {
  // Setup: deploy WDOT, CollateralVault, mock LendingPool (just a signer)
  describe('deposit()', () => { /* requires approval, updates available */ })
  describe('withdraw()', () => { /* moves available, fails on locked */ })
  describe('lockCollateral()', () => {
    /* only lendingPool can call */
    /* moves available → locked */
    /* reverts if insufficient available */
  })
  describe('releaseCollateral()', () => { /* moves locked → available */ })
  describe('seizeCollateral()', () => {
    /* sends WDOT to recipient */
    /* reverts on zero recipient */
  })
  describe('access control', () => {
    /* all onlyLendingPool functions revert when called by non-LP address */
  })
})
```

---

## Feature 4 — LendingPool

### Context
LendingPool is the core of DotBridge. It orchestrates: collateral checks,
position management, interest accrual, and disbursal of borrowed USDC
(locally or via RemittanceBridge). One position per user at a time (MVP).

### What to build
File: `packages/contracts/contracts/LendingPool.sol`

```
contract LendingPool (ReentrancyGuard, Pausable, Ownable)
│
├── Constants
│   ├── COLLATERAL_RATIO_BPS = 15_000  (150%)
│   ├── LIQ_THRESHOLD_BPS    = 13_000  (130%)
│   ├── LIQ_BONUS_BPS        =    500  (5%)
│   ├── INTEREST_RATE_BPS    =    500  (5% annual)
│   └── SECONDS_PER_YEAR     = 365 days
│
├── Struct Position { collateralWdot, debtUsdc, borrowTimestamp, isActive }
│
├── State
│   ├── vault:    ICollateralVault (immutable)
│   ├── oracle:   IPriceOracle    (immutable)
│   ├── usdc:     IERC20          (immutable)
│   ├── bridge:   IRemittanceBridge (mutable, set via setBridge)
│   ├── positions: mapping(address => Position)
│   ├── totalDebtUsdc: uint256
│   └── protocolFeesUsdc: uint256
│
├── borrow(usdcAmount, destChainId, remitRecipient) nonReentrant whenNotPaused
│   ├── CHECKS
│   │   ├── require(usdcAmount > 0)
│   │   ├── require(!positions[msg.sender].isActive, "one position per user")
│   │   ├── availableWdot = vault.getAvailableCollateral(msg.sender)
│   │   ├── require(availableWdot > 0, "no collateral deposited")
│   │   ├── collateralUsdWad = oracle.getWdotValueInUsd(availableWdot)
│   │   ├── debtUsdWad       = DecimalLib.usdcToWad(usdcAmount)
│   │   ├── maxBorrowWad     = DecimalLib.maxBorrow(collateralUsdWad, COLLATERAL_RATIO_BPS)
│   │   └── require(debtUsdWad <= maxBorrowWad, "insufficient collateral")
│   ├── EFFECTS
│   │   ├── vault.lockCollateral(msg.sender, availableWdot)
│   │   ├── positions[msg.sender] = Position{collateralWdot, debtUsdc, timestamp, true}
│   │   └── totalDebtUsdc += usdcAmount
│   └── INTERACTIONS
│       ├── if destChainId != 0 && bridge != address(0):
│       │   ├── usdc.safeApprove(bridge, usdcAmount)
│       │   └── bridge.sendRemittance(remitRecipient, usdcAmount, destChainId)
│       └── else: usdc.safeTransfer(msg.sender, usdcAmount)
│
├── repay() nonReentrant whenNotPaused
│   ├── CHECKS: require(pos.isActive)
│   ├── interest = _accrueInterest(pos.debtUsdc, pos.borrowTimestamp)
│   ├── totalRepayment = pos.debtUsdc + interest
│   ├── EFFECTS (before external calls — CEI):
│   │   ├── protocolFeesUsdc += interest
│   │   ├── totalDebtUsdc    -= pos.debtUsdc
│   │   └── delete positions[msg.sender]   ← BEFORE external call
│   └── INTERACTIONS:
│       ├── usdc.safeTransferFrom(msg.sender, address(this), totalRepayment)
│       └── vault.releaseCollateral(msg.sender, collateralToRelease)
│
├── liquidate(address user) nonReentrant whenNotPaused
│   ├── require(pos.isActive)
│   ├── hf = getHealthFactor(user)
│   ├── require(hf < DecimalLib.WAD, "position is healthy")
│   ├── interest  = _accrueInterest(pos.debtUsdc, pos.borrowTimestamp)
│   ├── totalDebt = pos.debtUsdc + interest
│   ├── EFFECTS: protocolFeesUsdc+=interest; totalDebtUsdc-=pos.debtUsdc; delete positions[user]
│   └── INTERACTIONS:
│       ├── usdc.safeTransferFrom(msg.sender, address(this), totalDebt)
│       └── vault.seizeCollateral(user, collateralWdot, msg.sender)
│
├── getHealthFactor(address) view → DecimalLib.healthFactor(...)
├── getRepaymentAmount(address) view → (principal, interest, total)
├── getMaxBorrow(address) view → maxBorrowWad
│
├── _accrueInterest(principal, ts) internal view
│   └── (principal * INTEREST_RATE_BPS * elapsed) / (BPS_BASE * SECONDS_PER_YEAR)
│
├── setBridge(address) onlyOwner
├── pause() / unpause() onlyOwner
└── withdrawFees(address to) onlyOwner
```

### Critical correctness checks
1. **CEI in repay()**: `delete positions[msg.sender]` MUST happen before
   `vault.releaseCollateral()` to prevent reentrancy. The position clearing is
   the state change; vault interaction is the external call.

2. **Interest precision**: `_accrueInterest` uses USDC (6dp) throughout.
   No WAD conversion needed since it's purely a USDC-to-USDC calculation.
   Just BPS arithmetic on the raw USDC amount.

3. **Bridge approval pattern**: Use `safeApprove(bridge, 0)` then
   `safeApprove(bridge, amount)` to handle ERC-20 approval race condition,
   or use `safeIncreaseAllowance`. OpenZeppelin SafeERC20 handles this.

4. **One position per user (MVP)**: The `require(!positions[msg.sender].isActive)`
   check prevents opening a second position. After repay/liquidation the
   position is `delete`d so the user can open a new one.

### Acceptance criteria
- [ ] `borrow()` reverts when health factor would be below 150%
- [ ] `borrow()` with `destChainId=0` sends USDC directly to borrower
- [ ] `borrow()` with `destChainId=56` calls `bridge.sendRemittance()`
- [ ] `repay()` calculates interest proportional to time elapsed
- [ ] `repay()` clears position and releases collateral
- [ ] `liquidate()` reverts on healthy positions (hf >= 1 WAD)
- [ ] `liquidate()` succeeds when DOT price drops below threshold
- [ ] `getHealthFactor()` returns `type(uint256).max` for users with no position
- [ ] `pause()` blocks borrow/repay/liquidate but NOT `getHealthFactor`
- [ ] Protocol fees accumulate in `protocolFeesUsdc` and are withdrawable

### Test gate
File: `packages/contracts/test/04_LendingPool.test.js`
`npx hardhat test test/04_LendingPool.test.js`

**Tests to write:**
```javascript
describe('Feature 4 — LendingPool', () => {
  // Setup: full deployment including all deps + wire-up
  describe('borrow() — local', () => {
    /* happy path at 150%, edge at max borrow, over-limit reverts */
  })
  describe('borrow() — with remittance', () => {
    /* destChainId=56, verify bridge.sendRemittance called */
    /* mock bridge emits RemittanceSent */
  })
  describe('repay()', () => {
    /* correct principal + interest, position cleared, collateral released */
    /* time-travel with evm_increaseTime to accrue interest */
  })
  describe('liquidate()', () => {
    /* healthy position reverts, crashed price succeeds */
    /* liquidator receives seized WDOT */
    /* protocol fees accumulate */
  })
  describe('health factor', () => {
    /* returns max for no position, correct value for active position */
  })
  describe('pause()', () => {
    /* borrow reverts when paused, admin can unpause */
  })
})
```

**Time-travel snippet for interest tests:**
```javascript
// Advance time by 1 year to accrue full 5% interest
await ethers.provider.send('evm_increaseTime', [365 * 24 * 60 * 60]);
await ethers.provider.send('evm_mine', []);
// Now getRepaymentAmount() should return ~5% more than borrowed
```

---

## Feature 5 — RemittanceBridge

### Context
RemittanceBridge wraps Hyperbridge's Token Gateway. In mock mode
(gateway = address(0)) it simulates cross-chain by doing a local USDC transfer.
In live mode it calls `ITokenGateway.teleport()`. Only LendingPool can trigger
sends. Transfer status is tracked on-chain.

### What to build
File: `packages/contracts/contracts/RemittanceBridge.sol`

```
contract RemittanceBridge (ReentrancyGuard, Ownable)
│
├── Enum TransferStatus { Pending, Completed, Failed }
├── Struct Transfer { sender, recipient, usdcAmount, destChainId, timestamp, status }
│
├── State
│   ├── hyperbridgeGateway: ITokenGateway (address(0) = mock)
│   ├── usdc:               IERC20 (immutable)
│   ├── lendingPool:        address
│   ├── transfers:          mapping(bytes32 => Transfer)
│   └── transferCount:      uint256 (for unique ID generation)
│
├── sendRemittance(recipient, usdcAmount, destChainId) onlyLendingPool nonReentrant
│   ├── require(recipient != address(0))
│   ├── require(usdcAmount > 0)
│   ├── require(destChainId > 0)
│   ├── usdc.safeTransferFrom(lendingPool, address(this), usdcAmount)
│       ← LendingPool must approve bridge BEFORE calling this
│   ├── transferId = keccak256(sender+recipient+amount+chainId+timestamp+count)
│   ├── Store Transfer record with Pending status
│   ├── if gateway == address(0): MOCK MODE
│   │   ├── usdc.safeTransfer(recipient, usdcAmount)
│   │   ├── transfer.status = Completed
│   │   └── emit RemittanceSent + RemittanceCompleted
│   └── else: LIVE MODE
│       ├── fee = gateway.estimateFee(destChainId, usdcAmount)
│       ├── usdc.safeApprove(gateway, usdcAmount)
│       ├── gateway.teleport{value: fee}(SendParams{...})
│       └── emit RemittanceSent
│
├── estimateFee(destChainId) view
│   └── if mock: return 0; else gateway.estimateFee(destChainId, 0)
│
├── getTransfer(bytes32) view → Transfer struct
│
├── setGateway(address) onlyOwner  ← switch mock → live
├── setLendingPool(address) onlyOwner
└── recoverTokens(token, to, amount) onlyOwner  ← emergency recovery
    receive() external payable   ← accept DOT for relayer fees
```

### Acceptance criteria
- [ ] `sendRemittance()` reverts when called by non-LendingPool address
- [ ] In mock mode: recipient receives USDC locally
- [ ] In mock mode: `RemittanceSent` + `RemittanceCompleted` both emitted
- [ ] `transferId` is unique across consecutive calls
- [ ] `estimateFee()` returns 0 in mock mode
- [ ] `setGateway(nonZeroAddress)` switches to live mode for next send
- [ ] `recoverTokens()` allows owner to rescue stuck tokens

### Test gate
File: `packages/contracts/test/05_RemittanceBridge.test.js`
`npx hardhat test test/05_RemittanceBridge.test.js`

---

## Feature 6 — Integration Test (Full Flow)

### Context
This test deploys all contracts, wires them up, and runs the complete
DotBridge user journey end-to-end on a local Hardhat node.

### What to verify
File: `packages/contracts/test/06_Integration.test.js` (already scaffolded)

Run: `npx hardhat test test/06_Integration.test.js`

**The 6-step journey:**
```
Alice:
  Step 1: wdot.deposit({ value: DOT(100) })      → receives 100 WDOT
  Step 2: vault.deposit(DOT(100))                 → 100 WDOT locked as collateral
  Step 3: pool.borrow(USDC(300), 0, address(0))  → receives $300 USDC locally
  Step 4: pool.borrow(USDC(200), 56, bob)        → $200 USDC bridged to Bob on BNB
  Step 5: pool.repay()                            → returns USDC+interest, gets WDOT back

Bob (liquidator):
  Step 6: oracle.setMockPrice(DOT_3_DOLLARS)      → crash DOT price
          pool.liquidate(alice)                   → seizes Alice's WDOT + 5% bonus
```

### Acceptance criteria
- [ ] All 6 steps complete without revert on local Hardhat node
- [ ] Collateral balances are consistent at every step (available + locked = total)
- [ ] Health factor is >1 WAD before price crash, <1 WAD after
- [ ] Mock bridge correctly routes USDC to recipient
- [ ] Protocol fees accumulate correctly after repay and liquidate
- [ ] Events are emitted at every step

---

## Feature 7 — Testnet Deployment

### Context
Deploy all contracts to Polkadot Hub Testnet (Westend Asset Hub).
Chain ID: 420420421. RPC: https://westend-asset-hub-eth-rpc.polkadot.io

### Pre-deployment checklist
- [ ] Get testnet WND from faucet: https://faucet.polkadot.io/westend
- [ ] Add Westend Hub to MetaMask:
      RPC: https://westend-asset-hub-eth-rpc.polkadot.io
      Chain ID: 420420421
      Symbol: WND, Decimals: 10
- [ ] Set `DEPLOYER_PRIVATE_KEY` in `.env` (root level)
- [ ] Confirm Hyperbridge Gateway address on Westend Hub testnet from:
      https://docs.hyperbridge.network/developers/evm/token-gateway
      If not yet available, leave `address(0)` for mock mode.
- [ ] Confirm USDC precompile address on Westend Hub from Polkadot docs.
      If not yet available, MockERC20 is deployed automatically.

### Deploy command
```bash
cd packages/contracts
npx hardhat run scripts/deploy.js --network polkadotHubTestnet
```

### What deploy.js does
1. Deploys WDOT, MockUSDC, PriceOracle, CollateralVault, RemittanceBridge, LendingPool
2. Calls `setLendingPool()` on Vault and Bridge
3. Calls `setBridge()` on LendingPool
4. Seeds LendingPool with 500,000 MockUSDC for borrowing
5. Writes addresses to `deployments/polkadotHubTestnet.json`
6. Copies ABIs + addresses to `packages/frontend/src/abis/`

### Post-deployment verification
```bash
# Verify WDOT is deployed and functional
cast call <WDOT_ADDRESS> "decimals()" --rpc-url https://westend-asset-hub-eth-rpc.polkadot.io
# Should return: 10

# Verify oracle price
cast call <ORACLE_ADDRESS> "getDotPriceWad()" --rpc-url ...
# Should return: 6000000000000000000 (=$6.00 WAD)
```

### Acceptance criteria
- [ ] All 5 contracts deployed with non-zero addresses
- [ ] `setLendingPool()` and `setBridge()` called successfully (check events)
- [ ] `deployments/polkadotHubTestnet.json` written with all addresses
- [ ] ABIs present in `packages/frontend/src/abis/`
- [ ] WDOT `decimals()` = 10 on testnet

---

## Feature 8 — Frontend: Wallet Connection + Chain Setup

### Context
React app using Wagmi v2 + RainbowKit. Must be configured for Polkadot Hub
Testnet (custom chain, not in RainbowKit's default list). Contract addresses
and ABIs are loaded from the auto-generated files in `src/abis/`.

### What to build

**`src/constants/chains.js`** — already scaffolded:
```javascript
export const polkadotHubTestnet = {
  id: 420420421,
  name: 'Polkadot Hub Testnet',
  nativeCurrency: { name: 'Westend DOT', symbol: 'WND', decimals: 10 },
  rpcUrls: { default: { http: ['https://westend-asset-hub-eth-rpc.polkadot.io'] } },
  blockExplorers: { default: { name: 'Subscan', url: 'https://assethub-westend.subscan.io' } },
  testnet: true,
};
```

**`src/contexts/Web3Context.jsx`**
```jsx
// Wagmi + RainbowKit config
// WagmiConfig with polkadotHubTestnet
// QueryClientProvider for tanstack/react-query
// RainbowKitProvider
// Export: useContracts() hook that returns contract instances
```

**`src/hooks/useContracts.js`**
```javascript
// Returns: { wdot, vault, pool, bridge, oracle, usdc }
// Each is a Wagmi contract instance: { address, abi }
// Addresses loaded from src/abis/addresses.json
// ABIs loaded from src/abis/{ContractName}.json
```

**`src/components/ConnectWallet/ConnectWallet.jsx`**
```jsx
// RainbowKit ConnectButton wrapper
// Shows: connected address (truncated), DOT balance, wrong network warning
// WND balance uses 10-decimal formatting: formatUnits(balance, 10)
```

### Acceptance criteria
- [ ] App connects to MetaMask on Polkadot Hub Testnet
- [ ] Wrong network shows a clear "Switch to Polkadot Hub Testnet" button
- [ ] Connected address displays correctly
- [ ] WND (DOT) balance displays with correct 10-decimal formatting
- [ ] Contract addresses and ABIs load without errors from `src/abis/`

---

## Feature 9 — Frontend: Wrap DOT + Deposit Collateral

### Context
Two-step user flow before borrowing: (1) wrap native DOT to WDOT, (2) approve
vault and deposit WDOT. Both are separate transactions that must be confirmed.
Show clear progress state for each step.

### What to build

**`src/hooks/useWDOT.js`**
```javascript
// useWrapDOT(dotAmount):    calls wdot.deposit({ value: dotAmount })
// useUnwrapWDOT(wdotAmount): calls wdot.withdraw(wdotAmount)
// useWDOTBalance(address):  reads wdot.balanceOf(address)
// DOT input uses 10 decimals: parseUnits(userInput, 10)
// Display uses:             formatUnits(balance, 10) + " WDOT"
```

**`src/hooks/useVault.js`**
```javascript
// useDepositCollateral(wdotAmount):
//   Step 1: wdot.approve(vaultAddress, wdotAmount)   ← separate tx
//   Step 2: vault.deposit(wdotAmount)                 ← separate tx
// useWithdrawCollateral(wdotAmount): vault.withdraw(wdotAmount)
// useCollateralBalances(address): reads available + locked from vault
```

**`src/components/Deposit/DepositFlow.jsx`**
```jsx
// Step indicator: [Wrap DOT] → [Approve Vault] → [Deposit]
// Input: DOT amount (validated: > 0, <= user's WND balance)
// Shows: current WDOT balance, current vault balance
// Handles: loading states per step, tx hash links, error messages
// All amounts formatted with 10 decimals
```

### Acceptance criteria
- [ ] User can wrap DOT → WDOT in one click (deposit tx)
- [ ] Approve + deposit are two separate wallet confirmations
- [ ] Loading state per transaction step (not just a global spinner)
- [ ] After deposit: vault available balance updates immediately (optimistic update or refetch)
- [ ] Input validation: cannot deposit more than wallet's WDOT balance
- [ ] All amounts displayed with correct 10-decimal formatting

---

## Feature 10 — Frontend: Borrow + Remit

### Context
Core DotBridge interaction. User sees their collateral value, max borrow, selects
USDC amount, optionally selects a destination chain + recipient address for remittance.
One transaction triggers both borrow and cross-chain send.

### What to build

**`src/hooks/useLendingPool.js`**
```javascript
// useBorrow(usdcAmount, destChainId, recipient):
//   calls pool.borrow(parseUnits(usdcAmount, 6), destChainId, recipient)
//   gas: estimateGas * 1.2 (20% buffer for dynamic Hub pricing)
//
// useRepay():
//   Step 1: usdc.approve(poolAddress, repaymentAmount)
//   Step 2: pool.repay()
//
// useLiquidate(userAddress): pool.liquidate(userAddress)
//
// usePosition(address):      reads pool.positions(address)
// useHealthFactor(address):  reads pool.getHealthFactor(address)
//                            formats as: (hf / 1e18).toFixed(2) → "1.95"
// useMaxBorrow(address):     reads pool.getMaxBorrow(address) → formatUnits(WAD, 18)
// useRepaymentAmount(address): reads pool.getRepaymentAmount(address)
```

**`src/components/Borrow/BorrowPanel.jsx`**
```jsx
// Shows:
//   Collateral: X.XX WDOT (~$X.XX USD)
//   Max borrow: $X.XX USDC
//   Health factor after borrow: live-updated as user types
//
// Form:
//   USDC amount input (validated: > 0, <= maxBorrow in USDC)
//   Toggle: [Borrow Locally] | [Borrow + Remit]
//   If remit: destination chain select (BNB/ETH/Base/Arbitrum)
//             recipient address input (validated: valid EVM address)
//   Estimated fee: calls bridge.estimateFee(destChainId) → format as "~0.01 DOT"
//
// Submit button: "Borrow $X USDC" or "Borrow + Send to [Chain]"
```

**`src/components/Remit/RemittanceStatus.jsx`**
```jsx
// Shows pending/completed remittances
// Reads transfer events from bridge contract
// Links to Subscan explorer for each transfer
// Shows: transferId (truncated), amount, destination, status badge
```

### Acceptance criteria
- [ ] Max borrow amount calculated correctly from on-chain data
- [ ] Health factor preview updates live as user adjusts borrow amount
- [ ] Local borrow sends USDC to user's wallet in same tx
- [ ] Remit borrow triggers bridge, recipient address validated
- [ ] Fee estimate shown before confirming remit
- [ ] Transaction hash + Subscan link shown after borrow confirms
- [ ] 20% gas buffer applied automatically

---

## Feature 11 — Frontend: Repay + Position Dashboard

### Context
User dashboard showing current position health, repayment amount, and one-click repay.
Health factor shown with color: green (>1.5), yellow (1.3–1.5), red (<1.3).

### What to build

**`src/components/Dashboard/PositionCard.jsx`**
```jsx
// Shows:
//   Collateral locked: X.XX WDOT
//   Debt: $X.XX USDC (principal) + $X.XX (accrued interest)
//   Total to repay: $X.XX USDC
//   Health factor: X.XX  (colored: green/yellow/red)
//   Progress bar: collateral coverage %
//
// Repay button:
//   Step 1: USDC approve (pool address, total repayment)
//   Step 2: pool.repay()
//   After: position clears, collateral released, shows "Position Closed"
```

**`src/components/Liquidate/LiquidationPanel.jsx`**
```jsx
// Shows positions with health factor < 1.3 (at-risk or liquidatable)
// For each: address (truncated), health factor, collateral value, debt
// "Liquidate" button for positions below 1.0 WAD
// Shows: expected WDOT received by liquidator
```

### Acceptance criteria
- [ ] Health factor color coding correct (green/yellow/red thresholds)
- [ ] Repayment amount includes accrued interest (matches contract view)
- [ ] Approve + repay are two wallet confirmations
- [ ] After repay: UI shows "No active position", collateral shows as available again
- [ ] Liquidation panel only shows unhealthy positions

---

## Feature 12 — End-to-End Demo Rehearsal

### Context
Demo Day is March 24–25. Camera on, 3-minute presentation. This feature is the
rehearsal script and the final checks before submission.

### Demo script (3 minutes)
```
00:00 — 00:30  Problem statement
  "Sending money from Lagos to London costs 7% and takes 3 days.
   Your DOT is sitting idle earning nothing.
   DotBridge fixes both."

00:30 — 01:00  Connect wallet + show collateral
  Connect MetaMask to Polkadot Hub Testnet.
  Wrap 10 WND → 10 WDOT. Deposit as collateral.
  Show: vault balance updates, health factor = ∞

01:00 — 02:00  Borrow + Remit
  Borrow $40 USDC. Destination: BNB Chain. Recipient: second wallet.
  Confirm in MetaMask.
  Show: RemittanceSent event in bridge, USDC arriving in BNB wallet.
  "One transaction. 30 seconds. Near-zero fees."

02:00 — 02:30  Repay + reclaim
  Repay $40 USDC + $0.02 interest (5 bps of a day).
  Show: WDOT returned to available balance.

02:30 — 03:00  Roadmap + ask
  V2: Chainlink live price feed, automated liquidation keeper.
  V3: Multi-collateral (vDOT via Bifrost SLPx).
  Ecosystem: applying for Velocity Labs DeFi Builders Program + W3F grant.
```

### Final submission checklist
- [ ] GitHub repo is public and open-source
- [ ] README.md explains the project, architecture, and how to run tests
- [ ] Demo video is 1–3 minutes, recorded clearly
- [ ] Pitch deck has: problem / solution / demo / architecture / roadmap
- [ ] All 6 test gates pass: `npx hardhat test`
- [ ] Contracts deployed on Polkadot Hub Testnet (Westend)
- [ ] `deployments/polkadotHubTestnet.json` committed to repo
- [ ] Frontend loads without errors and connects to testnet
- [ ] DoraHacks submission includes GitHub link + demo video + description

---

## Known Limitations to Acknowledge in Pitch

Be upfront — judges respect honesty about v1 scope:

| Limitation | Status | Roadmap fix |
|---|---|---|
| Mock price oracle | testnet only | Chainlink DOT/USD when available on Hub |
| No liquidation keeper bot | manual liquidation | V2: Chainlink Automation keeper |
| One position per user | MVP simplification | V2: multi-position support |
| Simple interest (not compound) | deliberate V1 choice | V2: per-block compound interest |
| Mock Hyperbridge (local transfer) | Gateway address pending | Live when Westend Hub Gateway published |
| No frontend audit | expected for hackathon | PAL audit subsidy post-win |

---

## Quick Reference: Contract Addresses (fill after deploy)

```
Network: Polkadot Hub Testnet (Westend Asset Hub, Chain ID: 420420421)

WDOT:             0x___________________________________________
MockUSDC:         0x___________________________________________
PriceOracle:      0x___________________________________________
CollateralVault:  0x___________________________________________
RemittanceBridge: 0x___________________________________________
LendingPool:      0x___________________________________________
```

---

## Quick Reference: Test Commands

```bash
# Run all test gates in sequence
cd packages/contracts

npx hardhat test test/01_WDOT.test.js
npx hardhat test test/02_PriceOracle.test.js
npx hardhat test test/03_CollateralVault.test.js
npx hardhat test test/04_LendingPool.test.js
npx hardhat test test/05_RemittanceBridge.test.js
npx hardhat test test/06_Integration.test.js

# Run all at once (only do this after all individual gates pass)
npx hardhat test

# Coverage report
npx hardhat coverage

# Deploy to testnet
npx hardhat run scripts/deploy.js --network polkadotHubTestnet
```

---

*Document version: 1.0 — March 2026*
*Built for: Polkadot Solidity Hackathon 2026 (DoraHacks)*
*Project: DotBridge — Borrow stablecoins against DOT. Send them anywhere.*
