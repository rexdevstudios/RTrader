import { NextRequest, NextResponse } from 'next/server';
import { VolatilityCurveService } from '@/packages/launchpad/volatility-curve-service';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rollingInflowEth = Number(searchParams.get('rollingInflowEth') || '1.5');
    const windowMinutes = Number(searchParams.get('windowMinutes') || '10');

    const evaluation = VolatilityCurveService.evaluateVolatilitySlope(rollingInflowEth, windowMinutes);

    return NextResponse.json({
      success: true,
      data: evaluation,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'VOLATILITY_EVALUATION_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rollingInflowEth, initialPriceWei, currentSupplySold, amountToBuy } = body;

    const inflow = Number(rollingInflowEth || 0);
    const evaluation = VolatilityCurveService.evaluateVolatilitySlope(inflow);

    let costWei = '0';
    if (initialPriceWei && currentSupplySold !== undefined && amountToBuy) {
      const calculated = VolatilityCurveService.calculateVolatilityAdjustedCost(
        BigInt(initialPriceWei),
        BigInt(currentSupplySold),
        BigInt(amountToBuy),
        evaluation.slopeMultiplierBps
      );
      costWei = calculated.toString();
    }

    return NextResponse.json({
      success: true,
      data: {
        evaluation,
        adjustedCostWei: costWei,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'VOLATILITY_CALCULATION_FAILED' },
      { status: 500 }
    );
  }
}
