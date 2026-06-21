import { Injectable } from '@nestjs/common';

/** 泰勒架简化六杆几何：根据测量摘要与器械配置计算 6 条杆的刻度与杆长。1 刻度 = 1mm。 */
export interface MeasurementSummary {
  anklePlantarflexion?: number;  // 踝关节跖屈角度
  footEversion?: number;         // 足内外翻角度
  calcanealForceLine?: number;   // 跟骨力线
  calcanealEversion?: number;    // 跟骨内外翻角度
  archHeight?: number;          // 足弓高度 mm
}

export interface InstrumentConfigInput {
  referenceRingId?: string;
  movingRingId?: string;
  rotationDirection?: '内旋' | '外旋';
  rotationAngle?: number;
  rodIds?: string[];  // 6 条杆
  combinationId?: string;
}

export interface RodScaleResult {
  rodIndex: number;
  scale: number;   // 统一刻度，1 = 1mm
  lengthMm: number;
}

/** 简化模型：两环间距与角度由测量近似，六杆铰点按标准 TSF 布置，杆长 = 基础长度 + 刻度（1刻度=1mm） */
@Injectable()
export class TaylorService {
  private readonly REF_BALL_MM = 20;

  /**
   * 根据测量结果与器械配置计算六条杆的刻度与杆长。
   * 简化公式：基础杆长来自器械，刻度由畸形角度/位移换算为每日调整量累加得到初始刻度。
   */
  calculateScales(
    measurementSummary: MeasurementSummary,
    instrumentConfig: InstrumentConfigInput,
    ringDiameterMm: number = 180,
    baseRodLengthsMm: number[] = [155, 155, 155, 155, 155, 155],
  ): RodScaleResult[] {
    const results: RodScaleResult[] = [];
    // 简化：用足弓高度与角度近似一个“初始偏移”，均匀分配到 6 条杆
    const arch = measurementSummary.archHeight ?? 0;
    const angleSum =
      (measurementSummary.anklePlantarflexion ?? 0) +
      (measurementSummary.footEversion ?? 0) +
      (measurementSummary.calcanealForceLine ?? 0) +
      (measurementSummary.calcanealEversion ?? 0);
    const rotation = instrumentConfig.rotationAngle ?? 0;
    const rotSign = instrumentConfig.rotationDirection === '外旋' ? 1 : -1;
    const offsetPerStrut = (arch * 0.1 + angleSum * 0.5 + rotation * rotSign * 0.3) / 6;

    for (let i = 0; i < 6; i++) {
      const baseLen = baseRodLengthsMm[i] ?? 155;
      const scaleOffset = offsetPerStrut * (i % 2 === 0 ? 1 : -1);
      const scale = Math.round(scaleOffset * 10) / 10;
      const lengthMm = Math.round((baseLen + scale) * 10) / 10;
      results.push({
        rodIndex: i + 1,
        scale: Math.max(0, Math.min(155, scale)),
        lengthMm: Math.max(100, Math.min(250, lengthMm)),
      });
    }
    return results;
  }
}
