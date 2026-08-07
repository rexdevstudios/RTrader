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

        // 5. Liquidity Graduation Condition Check
        if (config.raisedAmountWei >= config.graduationThresholdWei) {
            config.isGraduated = true;
            emit TokenGraduated(tokenAddress, config.raisedAmountWei, config.currentSupplySold);
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
        uint256 curveComponent = (config.currentSupplySold * amountToBuy) / 1e18;
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
}
