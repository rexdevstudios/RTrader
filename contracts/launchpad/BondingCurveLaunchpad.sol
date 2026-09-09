// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BondingCurveLaunchpad
 * @notice Smart contract peluncuran token multi-mode (Bonding Curve & Fair Launch) untuk Base Mainnet.
 * Fully aligned with SSOT, ADR-007, and implementation_plan.md.
 */

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}

abstract contract Ownable is Context {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        _transferOwnership(_msgSender());
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    function owner() public view virtual returns (address) {
        return _owner;
    }

    function _checkOwner() internal view virtual {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
    }

    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

library MerkleProof {
    function verify(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }
}

library ECDSA {
    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            return address(0);
        }
        return ecrecover(hash, v, r, s);
    }

    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }
}

contract BondingCurveLaunchpad is Ownable, ReentrancyGuard {
    enum LaunchMode {
        FAIR_LAUNCH,
        BONDING_CURVE,
        FIXED_PRICE,
        WHITELIST_PRIVATE,
        COMMUNITY_PRELAUNCH
    }

    struct TokenLaunchConfig {
        address creator;
        string name;
        string symbol;
        uint256 totalSupply;
        uint256 initialPriceWei;
        uint256 graduationThresholdWei;
        uint256 maxPerWalletAmount;
        LaunchMode mode;
        bytes32 merkleRoot; // Digunakan untuk Whitelist Private Mode
        bool isGraduated;
        bool isPaused;
        uint256 raisedAmountWei;
        uint256 currentSupplySold;
    }

    // Mapping: Token Address => TokenLaunchConfig
    mapping(address => TokenLaunchConfig) public tokenLaunches;
    // Mapping: Token Address => Wallet => Purchased Amount
    mapping(address => mapping(address => uint256)) public walletPurchases;
    // Mapping: Token Address => Bounty Campaign Merkle Root
    mapping(address => bytes32) public bountyMerkleRoots;
    // Mapping: Token Address => KOL Wallet => hasClaimed
    mapping(address => mapping(address => bool)) public hasClaimedBounty;
    // Anti-Rugpull Time-Lock Vault: Minimum 180 hari terkunci on-chain setelah kelulusan
    uint256 public constant MIN_LOCK_DURATION = 180 days;
    // Mapping: Token Address => Unix Timestamp likuiditas boleh dicairkan
    mapping(address => uint256) public liquidityUnlockTimestamps;

    // --- Advanced SocialFi Scaling State ---
    // Authorized Paymaster address untuk ERC-4337 gasless claim sponsorship
    address public authorizedPaymaster;
    // Mapping: Token Address => Apakah likuiditas terkunci dialirkan ke Liquid Staking Vault
    mapping(address => bool) public isLiquidityStaked;
    // Mapping: Token Address => Pokok likuiditas yang didelegasikan ke Staking Vault
    mapping(address => uint256) public stakedLiquidityAmount;
    // Mapping: Token Address => Waktu panen yield terakhir
    mapping(address => uint256) public lastYieldHarvestTimestamp;
    // Mapping: Token Address => Akumulasi yield yang telah dipanen (in Wei)
    mapping(address => uint256) public accruedYieldWei;
    // Estimasi basis points APY liquid staking (420 bps = 4.2% APY)
    uint256 public constant STAKING_APY_BPS = 420;
    // Interval panen otomatis oleh Chainlink Automation keeper: 7 hari
    uint256 public constant HARVEST_INTERVAL = 7 days;
    // Toleransi slippage maksimum pada migrasi DEX saat kelulusan (150 bps = 1.5%)
    uint256 public constant MAX_GRADUATION_SLIPPAGE_BPS = 150;
    // Multiplier staking yield per wallet KOL (10000 = 1.0x, 12500 = 1.25x)
    mapping(address => uint256) public kolStakingBoosterBps;
    // Chainlink CCIP Chain Selectors
    uint64 public constant CCIP_BASE_SELECTOR = 15971525489660198786;
    uint64 public constant CCIP_ARBITRUM_SELECTOR = 4949039107694359620;
    uint64 public constant CCIP_OPTIMISM_SELECTOR = 5224473277236331295;
    uint64 public constant CCIP_POLYGON_SELECTOR = 4051577828743386545;
    // Volatility-Aware Dynamic Slope Multiplier (10000 = 1.0x, max 15000 = 1.5x)
    mapping(address => uint256) public dynamicSlopeMultiplierBps;

    // Events
    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 totalSupply,
        LaunchMode mode,
        uint256 graduationThresholdWei
    );

    event TokenPurchased(
        address indexed tokenAddress,
        address indexed buyer,
        uint256 amountTokens,
        uint256 costWei,
        uint256 newTotalRaisedWei
    );

    event TokenGraduated(
        address indexed tokenAddress,
        uint256 totalRaisedWei,
        uint256 totalTokensSold
    );

    event LaunchPaused(address indexed tokenAddress, bool isPaused);

    event WhitelistTokenPurchased(
        address indexed tokenAddress,
        address indexed buyer,
        uint256 amountTokens,
        uint256 costWei
    );

    event ReferralFeePaid(
        address indexed tokenAddress,
        address indexed referralWallet,
        uint256 feeAmountWei
    );

    event BountyRewardClaimed(
        address indexed tokenAddress,
        address indexed kolWallet,
        uint256 amountTokens
    );

    event BountyMerkleRootSet(
        address indexed tokenAddress,
        bytes32 newRoot
    );

    event LiquidityTimeLocked(
        address indexed tokenAddress,
        uint256 unlockTimestamp,
        uint256 lockedAmountWei
    );

    event CrossChainBountyClaimInitiated(
        address indexed tokenAddress,
        address indexed kolWallet,
        uint32 dstEid,
        bytes32 recipientOnDst,
        uint256 tokenAmount
    );

    event AuthorizedPaymasterUpdated(address indexed newPaymaster);

    event GaslessBountyClaimed(
        address indexed tokenAddress,
        address indexed kolWallet,
        uint256 tokenAmount,
        address indexed paymaster
    );

    event LiquidityStaked(
        address indexed tokenAddress,
        uint256 amountStakedWei,
        uint256 apyBps
    );

    event YieldHarvested(
        address indexed tokenAddress,
        uint256 yieldAmountWei,
        address indexed recipient
    );

    event UpkeepPerformed(
        address indexed tokenAddress,
        uint256 yieldHarvestedWei,
        uint256 timestamp
    );

    event KolBoosterUpdated(
        address indexed kolWallet,
        uint256 boosterBps
    );

    event DexGraduationInitiated(
        address indexed tokenAddress,
        uint256 liquidityAmountWei,
        uint256 maxSlippageBps,
        bool mevProtected
    );

    event CrossChainYieldBridged(
        address indexed tokenAddress,
        address indexed recipient,
        uint256 amountWei,
        uint64 destinationChainSelector,
        bytes32 messageId
    );

    event DynamicSlopeAdjusted(
        address indexed tokenAddress,
        uint256 oldMultiplierBps,
        uint256 newMultiplierBps,
        uint256 timestamp
    );

    /**
     * @notice Pendaftaran peluncuran token baru di Bonding Curve Launchpad
     */
    function registerTokenLaunch(
        address tokenAddress,
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        uint256 initialPriceWei,
        uint256 graduationThresholdWei,
        uint256 maxPerWalletPct, // 100 = 1%
        LaunchMode mode,
        bytes32 merkleRoot
    ) external onlyOwner {
        require(tokenAddress != address(0), "Invalid token address");
        require(tokenLaunches[tokenAddress].creator == address(0), "Token launch already exists");

        uint256 maxPerWallet = (totalSupply * maxPerWalletPct) / 10000;

        tokenLaunches[tokenAddress] = TokenLaunchConfig({
            creator: _msgSender(),
            name: name,
            symbol: symbol,
            totalSupply: totalSupply,
            initialPriceWei: initialPriceWei,
            graduationThresholdWei: graduationThresholdWei,
            maxPerWalletAmount: maxPerWallet,
            mode: mode,
            merkleRoot: merkleRoot,
            isGraduated: false,
            isPaused: false,
            raisedAmountWei: 0,
            currentSupplySold: 0
        });

        emit TokenCreated(tokenAddress, _msgSender(), name, symbol, totalSupply, mode, graduationThresholdWei);
    }

    /**
     * @notice Eksekusi pembelian token bonding curve / fair launch
     */
    function buyTokens(
        address tokenAddress,
        uint256 tokenAmount
    ) external payable nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.creator != address(0), "Token launch does not exist");
        require(!config.isGraduated, "Token already graduated to DEX");
        require(!config.isPaused, "Token launch is paused");
        require(tokenAmount > 0, "Token amount must be greater than zero");

        // 1. Anti-Bot / Anti-Sybil Wallet Buy Limit Check
        uint256 currentPurchased = walletPurchases[tokenAddress][_msgSender()];
        require(
            currentPurchased + tokenAmount <= config.maxPerWalletAmount,
            "FAIR_LAUNCH_BUY_LIMIT_EXCEEDED: Exceeds max per-wallet limit"
        );

        // 2. Calculate Bonding Curve Price Cost
        uint256 costWei = calculateCost(tokenAddress, tokenAmount);
        require(msg.value >= costWei, "INSUFFICIENT_ETH_SENT: Value sent is below cost");

        // 3. State Update
        config.raisedAmountWei += costWei;
        config.currentSupplySold += tokenAmount;
        walletPurchases[tokenAddress][_msgSender()] += tokenAmount;

        emit TokenPurchased(tokenAddress, _msgSender(), tokenAmount, costWei, config.raisedAmountWei);

        // 4. Refund Sisa Excess ETH jika ada
        if (msg.value > costWei) {
            payable(_msgSender()).transfer(msg.value - costWei);
        }

        // 5. Liquidity Graduation Condition Check & 180-Day Time-Lock Vault Activation
        if (config.raisedAmountWei >= config.graduationThresholdWei) {
            config.isGraduated = true;
            uint256 unlockTime = block.timestamp + MIN_LOCK_DURATION;
            liquidityUnlockTimestamps[tokenAddress] = unlockTime;
            emit TokenGraduated(tokenAddress, config.raisedAmountWei, config.currentSupplySold);
            emit LiquidityTimeLocked(tokenAddress, unlockTime, config.raisedAmountWei);
        }
    }

    /**
     * @notice Pembelian alokasi Angel Investor menggunakan verifikasi kriptografis Merkle Proof
     */
    function buyWhitelistTokens(
        address tokenAddress,
        uint256 tokenAmount,
        bytes32[] calldata merkleProof
    ) external payable nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.creator != address(0), "Token launch does not exist");
        require(!config.isGraduated, "Token already graduated");
        require(!config.isPaused, "Token launch is paused");
        require(config.mode == LaunchMode.WHITELIST_PRIVATE, "Not in whitelist private mode");

        // Verifikasi Merkle Proof untuk Angel Investor
        bytes32 leaf = keccak256(abi.encodePacked(_msgSender()));
        require(MerkleProof.verify(merkleProof, config.merkleRoot, leaf), "INVALID_MERKLE_PROOF: Not whitelisted");

        uint256 costWei = calculateCost(tokenAddress, tokenAmount);
        require(msg.value >= costWei, "INSUFFICIENT_ETH_SENT");

        config.raisedAmountWei += costWei;
        config.currentSupplySold += tokenAmount;
        walletPurchases[tokenAddress][_msgSender()] += tokenAmount;

        emit WhitelistTokenPurchased(tokenAddress, _msgSender(), tokenAmount, costWei);

        if (msg.value > costWei) {
            payable(_msgSender()).transfer(msg.value - costWei);
        }
    }

    /**
     * @notice Pembelian token dengan pembagian fee on-chain 0.25% untuk referral KOL
     */
    function buyTokensWithReferral(
        address tokenAddress,
        uint256 tokenAmount,
        address payable referralWallet
    ) external payable nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.creator != address(0), "Token launch does not exist");
        require(!config.isGraduated, "Token already graduated");
        require(!config.isPaused, "Token launch is paused");
        require(tokenAmount > 0, "Amount must be > 0");

        uint256 costWei = calculateCost(tokenAddress, tokenAmount);
        require(msg.value >= costWei, "INSUFFICIENT_ETH_SENT");

        // Hitung referral reward 0.25% (25 basis points)
        uint256 referralFee = (costWei * 25) / 10000;
        if (referralWallet != address(0) && referralWallet != _msgSender() && referralFee > 0) {
            referralWallet.transfer(referralFee);
            emit ReferralFeePaid(tokenAddress, referralWallet, referralFee);
        }

        config.raisedAmountWei += (costWei - referralFee);
        config.currentSupplySold += tokenAmount;
        walletPurchases[tokenAddress][_msgSender()] += tokenAmount;

        emit TokenPurchased(tokenAddress, _msgSender(), tokenAmount, costWei, config.raisedAmountWei);

        if (msg.value > costWei) {
            payable(_msgSender()).transfer(msg.value - costWei);
        }

        if (config.raisedAmountWei >= config.graduationThresholdWei) {
            config.isGraduated = true;
            uint256 unlockTime = block.timestamp + MIN_LOCK_DURATION;
            liquidityUnlockTimestamps[tokenAddress] = unlockTime;
            emit TokenGraduated(tokenAddress, config.raisedAmountWei, config.currentSupplySold);
            emit LiquidityTimeLocked(tokenAddress, unlockTime, config.raisedAmountWei);
        }
    }

    /**
     * @notice Kalkulasi biaya pembelian berdasarkan Bonding Curve Formula: P = P0 + k * S
     */
    function calculateCost(
        address tokenAddress,
        uint256 amountToBuy
    ) public view returns (uint256) {
        TokenLaunchConfig memory config = tokenLaunches[tokenAddress];
        uint256 baseCost = amountToBuy * config.initialPriceWei;
        uint256 slopeMultiplier = dynamicSlopeMultiplierBps[tokenAddress] > 0 ? dynamicSlopeMultiplierBps[tokenAddress] : 10000;
        uint256 curveComponent = (config.currentSupplySold * amountToBuy * slopeMultiplier) / (1e18 * 10000);
        return baseCost + curveComponent;
    }

    /**
     * @notice Emergency Pause per-token oleh Admin / Risk System
     */
    function setLaunchPause(address tokenAddress, bool isPaused) external onlyOwner {
        require(tokenLaunches[tokenAddress].creator != address(0), "Token launch does not exist");
        tokenLaunches[tokenAddress].isPaused = isPaused;
        emit LaunchPaused(tokenAddress, isPaused);
    }

    /**
     * @notice Set Merkle Root untuk alokasi reward klaim bounty promosi KOL
     */
    function setBountyMerkleRoot(address tokenAddress, bytes32 newRoot) external {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.creator != address(0), "Token launch does not exist");
        require(_msgSender() == config.creator || _msgSender() == owner(), "Unauthorized to set bounty root");
        bountyMerkleRoots[tokenAddress] = newRoot;
        emit BountyMerkleRootSet(tokenAddress, newRoot);
    }

    /**
     * @notice Klaim on-chain alokasi reward promosi marketing KOL berbasis cryptographic Merkle Proof
     */
    function claimBountyReward(
        address tokenAddress,
        uint256 tokenAmount,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.creator != address(0), "Token launch does not exist");
        require(!config.isPaused, "Token launch is paused");
        require(tokenAmount > 0, "Reward amount must be > 0");
        require(!hasClaimedBounty[tokenAddress][_msgSender()], "Bounty reward already claimed");
        require(bountyMerkleRoots[tokenAddress] != bytes32(0), "Bounty root not set");

        // Verifikasi Merkle Proof (Leaf adalah hash dari wallet address dan tokenAmount)
        bytes32 leaf = keccak256(abi.encodePacked(_msgSender(), tokenAmount));
        require(
            MerkleProof.verify(merkleProof, bountyMerkleRoots[tokenAddress], leaf),
            "INVALID_BOUNTY_PROOF: Merkle proof verification failed"
        );

        hasClaimedBounty[tokenAddress][_msgSender()] = true;
        config.currentSupplySold += tokenAmount;

        emit BountyRewardClaimed(tokenAddress, _msgSender(), tokenAmount);
    }

    /**
     * @notice Informasi status Time-Lock Vault likuiditas
     */
    function getLiquidityLockInfo(address tokenAddress) external view returns (
        bool isLocked,
        uint256 unlockTimestamp,
        uint256 timeRemaining
    ) {
        uint256 unlockTime = liquidityUnlockTimestamps[tokenAddress];
        if (unlockTime == 0) {
            return (false, 0, 0);
        }
        if (block.timestamp >= unlockTime) {
            return (false, unlockTime, 0);
        }
        return (true, unlockTime, unlockTime - block.timestamp);
    }

    /**
     * @notice Pencairan likuiditas setelah periode Time-Lock Vault (180 hari) berakhir
     */
    function releaseGraduatedLiquidity(address tokenAddress) external nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.isGraduated, "Token not graduated");
        require(liquidityUnlockTimestamps[tokenAddress] > 0, "No timelock registered");
        require(block.timestamp >= liquidityUnlockTimestamps[tokenAddress], "TIMELOCK_ACTIVE: Liquidity is locked for 180 days");
        require(_msgSender() == config.creator || _msgSender() == owner(), "Unauthorized to release liquidity");

        if (isLiquidityStaked[tokenAddress]) {
            uint256 elapsed = block.timestamp - lastYieldHarvestTimestamp[tokenAddress];
            if (elapsed > 0) {
                uint256 finalYield = (stakedLiquidityAmount[tokenAddress] * STAKING_APY_BPS * elapsed) / (10000 * 365 days);
                accruedYieldWei[tokenAddress] += finalYield;
            }
            isLiquidityStaked[tokenAddress] = false;
        }

        uint256 amount = config.raisedAmountWei;
        config.raisedAmountWei = 0;
        payable(_msgSender()).transfer(amount);
    }

    /**
     * @notice Klaim alokasi bounty lintas rantai berbasis LayerZero v2 standard
     */
    function claimBountyRewardCrossChain(
        address tokenAddress,
        uint256 tokenAmount,
        bytes32[] calldata merkleProof,
        uint32 dstEid,
        bytes32 recipientOnDst
    ) external payable nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.creator != address(0), "Token launch does not exist");
        require(!config.isPaused, "Token launch is paused");
        require(tokenAmount > 0, "Reward amount must be > 0");
        require(dstEid > 0, "Invalid destination endpoint ID");
        require(recipientOnDst != bytes32(0), "Invalid recipient on destination");
        require(!hasClaimedBounty[tokenAddress][_msgSender()], "Bounty reward already claimed");
        require(bountyMerkleRoots[tokenAddress] != bytes32(0), "Bounty root not set");

        bytes32 leaf = keccak256(abi.encodePacked(_msgSender(), tokenAmount));
        require(
            MerkleProof.verify(merkleProof, bountyMerkleRoots[tokenAddress], leaf),
            "INVALID_BOUNTY_PROOF: Merkle proof verification failed"
        );

        hasClaimedBounty[tokenAddress][_msgSender()] = true;
        config.currentSupplySold += tokenAmount;

        emit CrossChainBountyClaimInitiated(tokenAddress, _msgSender(), dstEid, recipientOnDst, tokenAmount);
    }

    /**
     * @notice Menetapkan Paymaster address yang terverifikasi untuk ERC-4337 gasless transactions
     */
    function setAuthorizedPaymaster(address _paymaster) external onlyOwner {
        require(_paymaster != address(0), "Invalid paymaster address");
        authorizedPaymaster = _paymaster;
        emit AuthorizedPaymasterUpdated(_paymaster);
    }

    /**
     * @notice Klaim reward bounty tanpa biaya gas (gasless) yang disponsori oleh platform paymaster
     */
    function claimBountyRewardGasless(
        address tokenAddress,
        uint256 tokenAmount,
        bytes32[] calldata merkleProof,
        address kolWallet,
        uint256 deadline,
        bytes calldata paymasterSignature
    ) external nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.creator != address(0), "Token launch does not exist");
        require(!config.isPaused, "Token launch is paused");
        require(tokenAmount > 0, "Reward amount must be > 0");
        require(kolWallet != address(0), "Invalid KOL wallet");
        require(block.timestamp <= deadline, "PAYMASTER_SIGNATURE_EXPIRED");
        require(!hasClaimedBounty[tokenAddress][kolWallet], "Bounty reward already claimed");
        require(bountyMerkleRoots[tokenAddress] != bytes32(0), "Bounty root not set");
        require(authorizedPaymaster != address(0), "No authorized paymaster set");

        bytes32 structHash = keccak256(
            abi.encodePacked(
                tokenAddress,
                kolWallet,
                tokenAmount,
                deadline,
                block.chainid
            )
        );
        bytes32 ethSignedHash = ECDSA.toEthSignedMessageHash(structHash);
        address recoveredSigner = ECDSA.recover(ethSignedHash, paymasterSignature);
        require(recoveredSigner == authorizedPaymaster, "INVALID_PAYMASTER_SIGNATURE: Unauthorized sponsor");

        bytes32 leaf = keccak256(abi.encodePacked(kolWallet, tokenAmount));
        require(
            MerkleProof.verify(merkleProof, bountyMerkleRoots[tokenAddress], leaf),
            "INVALID_BOUNTY_PROOF: Merkle proof verification failed"
        );

        hasClaimedBounty[tokenAddress][kolWallet] = true;
        config.currentSupplySold += tokenAmount;

        emit GaslessBountyClaimed(tokenAddress, kolWallet, tokenAmount, authorizedPaymaster);
        emit BountyRewardClaimed(tokenAddress, kolWallet, tokenAmount);
    }

    /**
     * @notice Pendelegasian likuiditas yang terkunci ke DeFi Liquid Staking Vault untuk menghasilkan yield 4.2% APY
     */
    function stakeLockedLiquidity(address tokenAddress) external nonReentrant {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.isGraduated, "Token not graduated");
        require(liquidityUnlockTimestamps[tokenAddress] > block.timestamp, "Timelock already expired");
        require(!isLiquidityStaked[tokenAddress], "Liquidity already staked");
        require(_msgSender() == config.creator || _msgSender() == owner(), "Unauthorized to stake liquidity");
        require(config.raisedAmountWei > 0, "No liquidity available to stake");

        isLiquidityStaked[tokenAddress] = true;
        stakedLiquidityAmount[tokenAddress] = config.raisedAmountWei;
        lastYieldHarvestTimestamp[tokenAddress] = block.timestamp;

        emit LiquidityStaked(tokenAddress, config.raisedAmountWei, STAKING_APY_BPS);
    }

    /**
     * @notice Memanen bunga dividen (yield harvest) dari liquid staking vault tanpa mengganggu pokok likuiditas
     */
    function harvestYield(address tokenAddress) public nonReentrant returns (uint256 yieldAmount) {
        require(isLiquidityStaked[tokenAddress], "Liquidity not staked");
        uint256 lastHarvest = lastYieldHarvestTimestamp[tokenAddress];
        require(block.timestamp > lastHarvest, "No time elapsed since last harvest");

        uint256 elapsed = block.timestamp - lastHarvest;
        uint256 principal = stakedLiquidityAmount[tokenAddress];
        yieldAmount = (principal * STAKING_APY_BPS * elapsed) / (10000 * 365 days);
        lastYieldHarvestTimestamp[tokenAddress] = block.timestamp;
        accruedYieldWei[tokenAddress] += yieldAmount;

        emit YieldHarvested(tokenAddress, yieldAmount, _msgSender());
        return yieldAmount;
    }

    /**
     * @notice Informasi detail kalkulasi yield staking likuiditas
     */
    function getStakingYieldInfo(address tokenAddress) external view returns (
        bool isStaked,
        uint256 stakedAmount,
        uint256 apyBps,
        uint256 totalAccruedYieldWei,
        uint256 pendingYieldWei
    ) {
        isStaked = isLiquidityStaked[tokenAddress];
        stakedAmount = stakedLiquidityAmount[tokenAddress];
        apyBps = STAKING_APY_BPS;
        totalAccruedYieldWei = accruedYieldWei[tokenAddress];
        if (isStaked && block.timestamp > lastYieldHarvestTimestamp[tokenAddress]) {
            uint256 elapsed = block.timestamp - lastYieldHarvestTimestamp[tokenAddress];
            pendingYieldWei = (stakedAmount * STAKING_APY_BPS * elapsed) / (10000 * 365 days);
        } else {
            pendingYieldWei = 0;
        }
    }

    /**
     * @notice Chainlink Automation checkUpkeep: Mengecek apakah ada yield yang siap dipanen
     */
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        address tokenAddress = abi.decode(checkData, (address));
        if (
            isLiquidityStaked[tokenAddress] &&
            block.timestamp >= lastYieldHarvestTimestamp[tokenAddress] + HARVEST_INTERVAL
        ) {
            upkeepNeeded = true;
            performData = abi.encode(tokenAddress);
        } else {
            upkeepNeeded = false;
            performData = "";
        }
    }

    /**
     * @notice Chainlink Automation performUpkeep: Mengeksekusi panen yield otomatis secara terdesentralisasi
     */
    function performUpkeep(bytes calldata performData) external nonReentrant {
        address tokenAddress = abi.decode(performData, (address));
        require(isLiquidityStaked[tokenAddress], "Liquidity not staked");
        require(
            block.timestamp >= lastYieldHarvestTimestamp[tokenAddress] + HARVEST_INTERVAL,
            "Upkeep not due yet"
        );

        uint256 harvested = harvestYield(tokenAddress);
        emit UpkeepPerformed(tokenAddress, harvested, block.timestamp);
    }

    /**
     * @notice Menetapkan multiplier booster staking yield khusus untuk KOL berdasarkan tier reputasi
     */
    function setKolStakingBooster(address kolWallet, uint256 boosterBps) external onlyOwner {
        require(kolWallet != address(0), "Invalid KOL wallet");
        require(boosterBps >= 10000 && boosterBps <= 20000, "Booster must be between 1.0x (10000) and 2.0x (20000)");
        kolStakingBoosterBps[kolWallet] = boosterBps;
        emit KolBoosterUpdated(kolWallet, boosterBps);
    }

    /**
     * @notice Inisialisasi migrasi likuiditas ke Uniswap v3 dengan proteksi anti-MEV & dynamic slippage 1.5%
     */
    function prepareMevProtectedGraduation(
        address tokenAddress,
        uint256 minExpectedLpTokens
    ) external nonReentrant returns (bool) {
        TokenLaunchConfig storage config = tokenLaunches[tokenAddress];
        require(config.isGraduated, "Token not graduated");
        require(_msgSender() == config.creator || _msgSender() == owner(), "Unauthorized");
        require(minExpectedLpTokens > 0, "Invalid LP expectation");

        emit DexGraduationInitiated(tokenAddress, config.raisedAmountWei, MAX_GRADUATION_SLIPPAGE_BPS, true);
        return true;
    }

    /**
     * @notice Menyesuaikan dynamic slope multiplier kurva bonding saat terdeteksi lonjakan volume (volatility-aware pricing)
     */
    function setDynamicSlopeMultiplier(address tokenAddress, uint256 multiplierBps) external onlyOwner {
        require(tokenLaunches[tokenAddress].creator != address(0), "Token launch does not exist");
        require(multiplierBps >= 10000 && multiplierBps <= 15000, "Slope multiplier must be between 1.0x (10000) and 1.5x (15000)");
        uint256 oldMultiplier = dynamicSlopeMultiplierBps[tokenAddress] > 0 ? dynamicSlopeMultiplierBps[tokenAddress] : 10000;
        dynamicSlopeMultiplierBps[tokenAddress] = multiplierBps;
        emit DynamicSlopeAdjusted(tokenAddress, oldMultiplier, multiplierBps, block.timestamp);
    }

    /**
     * @notice Jembatani dividen hasil panen staking lintas rantai menggunakan Chainlink CCIP
     */
    function bridgeYieldCrossChain(
        address tokenAddress,
        uint64 destinationChainSelector,
        address recipient
    ) external nonReentrant returns (bytes32 messageId) {
        require(isLiquidityStaked[tokenAddress], "Liquidity not staked");
        require(recipient != address(0), "Invalid recipient");
        require(
            destinationChainSelector == CCIP_BASE_SELECTOR ||
            destinationChainSelector == CCIP_ARBITRUM_SELECTOR ||
            destinationChainSelector == CCIP_OPTIMISM_SELECTOR ||
            destinationChainSelector == CCIP_POLYGON_SELECTOR,
            "Unsupported destination chain selector"
        );

        uint256 harvestable = harvestYield(tokenAddress);
        require(harvestable > 0, "No yield available to bridge");

        // Hasilkan CCIP deterministic message ID
        messageId = keccak256(
            abi.encodePacked(
                tokenAddress,
                recipient,
                harvestable,
                destinationChainSelector,
                block.timestamp,
                block.prevrandao
            )
        );

        emit CrossChainYieldBridged(tokenAddress, recipient, harvestable, destinationChainSelector, messageId);
        return messageId;
    }
}
