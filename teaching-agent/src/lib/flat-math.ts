/**
 * 题库是早期从 .doc 抽出来的，公式被拍成了纯文本：h_f′、a_s′、εs、h0 这种。
 * 这里把「$...$ 之外」的这类写法补成 LaTeX，交给 KaTeX（页面）和 PDF 排版器显示成真正的角标。
 * 已经在 $...$ 里的公式原样不动。
 */

const GREEK = "αβγδεζηθκλμνξπρστφχψωΔΣΠΦΨΩ";
const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/** 角标里的常见词，按正体排（\min、\max 这类） */
const UPRIGHT: Record<string, string> = { min: "\\min", max: "\\max" };

function subscript(value: string) {
  const upright = UPRIGHT[value];
  return upright ?? value;
}

export function normalizeFlatMath(input: string): string {
  // 奇数段是 $...$ 里的内容，跳过
  return input
    .split("$")
    .map((chunk, index) => {
      if (index % 2 === 1) return chunk;
      const subscriptRun = `[A-Za-z0-9{}${GREEK}]*[′']|[A-Za-z0-9{}${GREEK}]+`;
      return chunk
        // 带下划线的写法：h_f′ → $h_f'$，B_s → $B_s$，ξ_b → $ξ_b$
        // 撇号处收尾，免得把紧跟的变量也吞成下标（b_f′h₀ 里的 h₀ 是另一个量）
        .replace(
          new RegExp(`[A-Za-z${GREEK}][A-Za-z0-9]*(?:_(?:${subscriptRun}))+`, "g"),
          (match) => `$${match.replace(/′/g, "'")}$`,
        )
        // Unicode 角标（h₀ 这类）也统一成公式
        .replace(
          new RegExp(`([A-Za-z${GREEK}])([${SUB_DIGITS}]+)`, "g"),
          (_match, base: string, digits: string) =>
            `$${base}_{${[...digits].map((digit) => SUB_DIGITS.indexOf(digit)).join("")}}$`,
        )
        // 希腊字母带角标：εcu → $ε_{cu}$，ρmin → $ρ_{\min}$
        .replace(new RegExp(`[${GREEK}][A-Za-z]{1,4}`, "g"), (match) => `$${match[0]}_{${subscript(match.slice(1))}}$`)
        // 字母 + 撇号但没有下划线：as′ → $a_s'$
        .replace(/([a-z])([a-z]{1,2})′/g, (_match, base: string, sub: string) => `$${base}_${sub}'$`)
        // 单字母 + 数字：h0 → $h_0$；单位里的 m2 写成 m²
        .replace(/\b([a-z])(\d+)\b/g, (_match, letter: string, digits: string) =>
          letter === "m"
            ? `m${digits === "2" ? "²" : digits === "3" ? "³" : digits}`
            : `$${letter}_{${digits}}$`,
        );
    })
    .join("$");
}
