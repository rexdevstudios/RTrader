/**
 * tests/phase-orchestrator.test.ts
 *
 * Comprehensive Test Suite for Autonomous Phase Orchestration (Phase 3 -> 4 -> 5 -> 6).
 */
import { describe, it, expect } from "bun:test";
import {
  determinePhaseProgression,
  executePhaseTransition,
  DEFAULT_TRANSITION_CRITERIA,
  type PhaseEvaluationResult,
} from "../src/modules/orchestration/phase-orchestrator.ts";

describe("Autonomous Phase Orchestrator (Phase 3 -> 4 -> 5 -> 6)", () => {
  const dummyCA = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
  const dummyTicker = "PUMPRUN";
  const dummyChain = "base";

  // 1. Phase 3: Market Catalyst Evaluation
  describe("Phase 3: Market Catalyst", () => {
    it("1.1 should stay in Phase 3 when volume < $50 and makers < 5", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 12.5,
        uniqueMakers: 2,
        creatorFeeAvailableWeth: 0,
        operatorBalanceEth: 0.00065,
        isGasFloorSafe: true,
        flywheelCyclesCount: 0,
        totalRecycledWeth: 0,
        bountyCampaignActive: false,
        fleetDeployedChains: ["base"],
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_3_CATALYST");
      expect(res.transitionEligible).toBe(false);
      expect(res.unmetConditions.length).toBeGreaterThan(0);
      expect(res.unmetConditions[0]).toContain("Volume 24H");
      expect(res.safetyGatePassed).toBe(true);
    });

    it("1.2 should allow transition to Phase 4 when volume >= $50 and gas floor is safe", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 65.0,
        uniqueMakers: 3,
        creatorFeeAvailableWeth: 0,
        operatorBalanceEth: 0.00065,
        isGasFloorSafe: true,
        flywheelCyclesCount: 0,
        totalRecycledWeth: 0,
        bountyCampaignActive: false,
        fleetDeployedChains: ["base"],
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_3_CATALYST");
      expect(res.transitionEligible).toBe(true);
      expect(res.nextPhase).toBe("PHASE_4_HARVEST");
      expect(res.unmetConditions).toHaveLength(0);
      expect(res.safetyGatePassed).toBe(true);
    });

    it("1.3 should allow transition to Phase 4 when unique makers >= 5", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 20.0,
        uniqueMakers: 6,
        creatorFeeAvailableWeth: 0,
        operatorBalanceEth: 0.00065,
        isGasFloorSafe: true,
        flywheelCyclesCount: 0,
        totalRecycledWeth: 0,
        bountyCampaignActive: false,
        fleetDeployedChains: ["base"],
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_3_CATALYST");
      expect(res.transitionEligible).toBe(true);
      expect(res.nextPhase).toBe("PHASE_4_HARVEST");
      expect(res.safetyGatePassed).toBe(true);
    });

    it("1.4 should block transition if operator gas balance is below floor (0.0003 ETH)", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 100.0,
        uniqueMakers: 10,
        creatorFeeAvailableWeth: 0,
        operatorBalanceEth: 0.00015, // Below 0.0003 ETH floor!
        isGasFloorSafe: false,
        flywheelCyclesCount: 0,
        totalRecycledWeth: 0,
        bountyCampaignActive: false,
        fleetDeployedChains: ["base"],
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.safetyGatePassed).toBe(false);
      expect(res.safetyGateReason).toContain("OPERATOR_GAS_FLOOR_BREACH");
      expect(res.transitionEligible).toBe(false);
    });
  });

  // 2. Phase 4: Harvest & Flywheel Evaluation
  describe("Phase 4: Harvest & Flywheel", () => {
    it("2.1 should detect Phase 4 when flywheel cycles exist, but block Phase 5 if surplus < 0.005 WETH", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 80.0,
        uniqueMakers: 12,
        creatorFeeAvailableWeth: 0.001, // < 0.005 WETH
        operatorBalanceEth: 0.00065,
        isGasFloorSafe: true,
        flywheelCyclesCount: 3,
        totalRecycledWeth: 0.000003,
        bountyCampaignActive: false,
        fleetDeployedChains: ["base"],
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_4_HARVEST");
      expect(res.transitionEligible).toBe(false);
      expect(res.nextPhase).toBe("PHASE_5_SOCIALFI");
      expect(res.unmetConditions[0]).toContain("Creator Kas Surplus");
    });

    it("2.2 should allow transition from Phase 4 to Phase 5 when surplus >= 0.005 WETH", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 150.0,
        uniqueMakers: 25,
        creatorFeeAvailableWeth: 0.0065, // >= 0.005 WETH
        operatorBalanceEth: 0.0008,
        isGasFloorSafe: true,
        flywheelCyclesCount: 7,
        totalRecycledWeth: 0.05,
        bountyCampaignActive: false,
        fleetDeployedChains: ["base"],
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_4_HARVEST");
      expect(res.transitionEligible).toBe(true);
      expect(res.nextPhase).toBe("PHASE_5_SOCIALFI");
      expect(res.unmetConditions).toHaveLength(0);
    });
  });

  // 3. Phase 5: SocialFi Bounty Evaluation
  describe("Phase 5: SocialFi Bounty", () => {
    it("3.1 should detect Phase 5 when bounty campaign is active, but block Phase 6 if only 1 chain deployed", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 200.0,
        uniqueMakers: 40,
        creatorFeeAvailableWeth: 0.01,
        operatorBalanceEth: 0.001,
        isGasFloorSafe: true,
        flywheelCyclesCount: 10,
        totalRecycledWeth: 0.1,
        bountyCampaignActive: true,
        fleetDeployedChains: ["base"], // Only 1 chain
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_5_SOCIALFI");
      expect(res.transitionEligible).toBe(false);
      expect(res.nextPhase).toBe("PHASE_6_FLEET");
      expect(res.unmetConditions[0]).toContain("Multi-chain fleet not yet provisioned");
    });

    it("3.2 should allow transition to Phase 6 when secondary chains are provisioned", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 200.0,
        uniqueMakers: 40,
        creatorFeeAvailableWeth: 0.01,
        operatorBalanceEth: 0.001,
        isGasFloorSafe: true,
        flywheelCyclesCount: 10,
        totalRecycledWeth: 0.1,
        bountyCampaignActive: true,
        fleetDeployedChains: ["base", "arc"], // 2 chains!
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_6_FLEET");
    });
  });

  // 4. Phase 6: Multi-Chain Fleet
  describe("Phase 6: Multi-Chain Fleet", () => {
    it("4.1 should detect Phase 6 Fleet when multiple chains are live", () => {
      const metrics: PhaseEvaluationResult["metrics"] = {
        volume24hUsd: 500.0,
        uniqueMakers: 100,
        creatorFeeAvailableWeth: 0.05,
        operatorBalanceEth: 0.002,
        isGasFloorSafe: true,
        flywheelCyclesCount: 15,
        totalRecycledWeth: 0.3,
        bountyCampaignActive: true,
        fleetDeployedChains: ["base", "arc", "robinhood"],
      };

      const res = determinePhaseProgression(dummyCA, dummyTicker, dummyChain, metrics);

      expect(res.currentPhase).toBe("PHASE_6_FLEET");
      expect(res.transitionEligible).toBe(false); // Ultimate phase reached!
    });
  });

  // 5. executePhaseTransition Execution & Audit Trail
  describe("5. executePhaseTransition Execution & Audit Trail", () => {
    it("5.1 should successfully execute Phase 3 -> Phase 4 transition and write audit log", async () => {
      const eligiblePhase3: PhaseEvaluationResult = {
        currentPhase: "PHASE_3_CATALYST",
        nextPhase: "PHASE_4_HARVEST",
        targetTokenAddress: dummyCA,
        ticker: dummyTicker,
        chain: dummyChain,
        metrics: {
          volume24hUsd: 85.0,
          uniqueMakers: 8,
          creatorFeeAvailableWeth: 0,
          operatorBalanceEth: 0.00065,
          isGasFloorSafe: true,
          flywheelCyclesCount: 0,
          totalRecycledWeth: 0,
          bountyCampaignActive: false,
          fleetDeployedChains: ["base"],
        },
        transitionEligible: true,
        unmetConditions: [],
        safetyGatePassed: true,
      };

      const result = await executePhaseTransition(eligiblePhase3, { simulateOnly: true });

      expect(result.success).toBe(true);
      expect(result.action).toBe("PHASE_3_TO_PHASE_4_HARVEST_INITIALIZED");
      expect(result.auditLogId).toBeDefined();
    });

    it("5.2 should successfully execute Phase 4 -> Phase 5 transition and generate Merkle Root", async () => {
      const eligiblePhase4: PhaseEvaluationResult = {
        currentPhase: "PHASE_4_HARVEST",
        nextPhase: "PHASE_5_SOCIALFI",
        targetTokenAddress: dummyCA,
        ticker: dummyTicker,
        chain: dummyChain,
        metrics: {
          volume24hUsd: 150.0,
          uniqueMakers: 20,
          creatorFeeAvailableWeth: 0.0075,
          operatorBalanceEth: 0.00075,
          isGasFloorSafe: true,
          flywheelCyclesCount: 5,
          totalRecycledWeth: 0.03,
          bountyCampaignActive: false,
          fleetDeployedChains: ["base"],
        },
        transitionEligible: true,
        unmetConditions: [],
        safetyGatePassed: true,
      };

      const result = await executePhaseTransition(eligiblePhase4, {
        simulateOnly: true,
        customBountyClaims: [
          { walletAddress: "0x1111111111111111111111111111111111111111", tokenAmount: 1000n * 10n ** 18n },
          { walletAddress: "0x2222222222222222222222222222222222222222", tokenAmount: 2000n * 10n ** 18n },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("PHASE_4_TO_PHASE_5_SOCIALFI_MERKLE_PROVISIONED");
      expect(result.auditLogId).toBeDefined();
    });

    it("5.3 should reject transition if transitionEligible is false", async () => {
      const ineligblePhase: PhaseEvaluationResult = {
        currentPhase: "PHASE_3_CATALYST",
        nextPhase: "PHASE_4_HARVEST",
        targetTokenAddress: dummyCA,
        ticker: dummyTicker,
        chain: dummyChain,
        metrics: {
          volume24hUsd: 10.0,
          uniqueMakers: 1,
          creatorFeeAvailableWeth: 0,
          operatorBalanceEth: 0.00065,
          isGasFloorSafe: true,
          flywheelCyclesCount: 0,
          totalRecycledWeth: 0,
          bountyCampaignActive: false,
          fleetDeployedChains: ["base"],
        },
        transitionEligible: false,
        unmetConditions: ["Volume 24H $10.00 < required $50.00"],
        safetyGatePassed: true,
      };

      const result = await executePhaseTransition(ineligblePhase);

      expect(result.success).toBe(false);
      expect(result.action).toBe("TRANSITION_BLOCKED");
      expect(result.error).toContain("TRANSITION_BLOCKED");
    });
  });
});
