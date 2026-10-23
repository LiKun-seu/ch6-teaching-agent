"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** 第 37 页讲完配筋率之后的示意。阈值只用于看形态，不是规范计算。 */
const RHO_MIN = 0.2;
const RHO_B = 2.5;

function modeOf(rho: number) {
  if (rho < RHO_MIN) return { name: "少筋", note: "一开裂，钢筋就到了屈服。裂缝一下拉开。" };
  if (rho <= RHO_B) return { name: "适筋", note: "钢筋先屈服，混凝土后压坏。中间有一段变形。" };
  return { name: "超筋", note: "混凝土先压坏，钢筋还没屈服。几乎没有预兆。" };
}

export function ReinforcementLab() {
  const [rho, setRho] = useState(1.2);
  const mode = modeOf(rho);
  const bars = Math.min(8, Math.max(1, Math.round(rho / 0.45)));
  const compression = Math.min(0.72, Math.max(0.12, (rho - 0.1) / 5));

  return (
    <Card className="overflow-hidden shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">配筋率 · 拖一下看破坏形态</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative mx-auto h-44 w-full max-w-sm">
          <div className="absolute inset-x-8 bottom-6 top-2 overflow-hidden rounded-sm border border-ink/20 bg-paper">
            <div
              className="absolute inset-x-0 top-0 bg-ink/10"
              style={{ height: `${compression * 100}%` }}
            />
            <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
              {Array.from({ length: bars }, (_, i) => (
                <span key={i} className="h-2.5 w-2.5 rounded-full bg-ink" />
              ))}
            </div>
            {mode.name === "少筋" ? (
              <div className="absolute left-1/2 top-3 h-[70%] w-px -translate-x-1/2 bg-ink/50" />
            ) : null}
          </div>
          <div className="absolute bottom-0 left-0 right-0 text-center text-[11px] text-ink-faint">
            受压区跟着配筋率变高
          </div>
        </div>

        <label className="block text-[13px] text-ink">
          配筋率 ρ = {rho.toFixed(2)}%
          <input
            type="range"
            min={0.05}
            max={4}
            step={0.05}
            value={rho}
            onChange={(e) => setRho(Number(e.target.value))}
            className="mt-2 block w-full accent-ink"
          />
        </label>

        <div className="text-[14px] leading-6 text-ink">
          <span className="font-medium">{mode.name}</span>
          <span className="text-ink-soft"> · {mode.note}</span>
        </div>
        <p className="text-[11px] leading-5 text-ink-faint">
          示意：ρ &lt; {RHO_MIN}% 看作少筋，ρ &gt; {RHO_B}% 看作超筋。界限要按材料算，这里只看形态。
        </p>
      </CardContent>
    </Card>
  );
}
