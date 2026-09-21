/**
 * src/modules/arc/arc-chain-definition.ts
 *
 * Official Viem Chain definition for Arc Mainnet (Chain ID 5042).
 * Source of Truth: Circle Arc Documentation (https://docs.arc.io)
 */

import { defineChain, type Chain } from "viem";
import { ARC_CHAIN_ID, ARC_CHAIN_NAME, ARC_RPC_DEFAULT, ARC_EXPLORER_DEFAULT } from "./types.ts";

export const arcMainnet: Chain = defineChain({
  id: ARC_CHAIN_ID,
  name: ARC_CHAIN_NAME,
  nativeCurrency: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [ARC_RPC_DEFAULT],
    },
    public: {
      http: [
        ARC_RPC_DEFAULT,
        "https://rpc.arc-scan.org",
        "https://5042.rpc.thirdweb.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: ARC_EXPLORER_DEFAULT,
    },
  },
});
