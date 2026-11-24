export type UnitCategory =
  | "css"
  | "duration"
  | "length"
  | "mass"
  | "temperature"
  | "area"
  | "volume"
  | "angle";

export interface CssContext {
  rootPx: number;
  parentPx: number;
  vwPx: number;
  vhPx: number;
}

export interface UnitResultRow {
  id: string;
  symbol: string;
  labelEn: string;
  labelZh: string;
  raw: number;
  formatted: string;
}

interface LinearUnitDef {
  id: string;
  symbol: string;
  labelEn: string;
  labelZh: string;
  factorToBase: number;
}

const DURATION_UNITS: LinearUnitDef[] = [
  { id: "ns", symbol: "ns", labelEn: "Nanosecond", labelZh: "纳秒", factorToBase: 1e-6 },
  { id: "us", symbol: "µs", labelEn: "Microsecond", labelZh: "微秒", factorToBase: 1e-3 },
  { id: "ms", symbol: "ms", labelEn: "Millisecond", labelZh: "毫秒", factorToBase: 1 },
  { id: "s", symbol: "s", labelEn: "Second", labelZh: "秒", factorToBase: 1000 },
  { id: "min", symbol: "min", labelEn: "Minute", labelZh: "分钟", factorToBase: 60 * 1000 },
  { id: "h", symbol: "h", labelEn: "Hour", labelZh: "小时", factorToBase: 3600 * 1000 },
  { id: "d", symbol: "d", labelEn: "Day", labelZh: "天", factorToBase: 86400 * 1000 },
  { id: "wk", symbol: "wk", labelEn: "Week", labelZh: "周", factorToBase: 7 * 86400 * 1000 },
  { id: "mo", symbol: "mo", labelEn: "Month (30d)", labelZh: "月 (30天)", factorToBase: 30 * 86400 * 1000 },
  { id: "yr", symbol: "yr", labelEn: "Year (365d)", labelZh: "年 (365天)", factorToBase: 365 * 86400 * 1000 },
];

const LENGTH_UNITS: LinearUnitDef[] = [
  { id: "mm", symbol: "mm", labelEn: "Millimeter", labelZh: "毫米", factorToBase: 0.001 },
  { id: "cm", symbol: "cm", labelEn: "Centimeter", labelZh: "厘米", factorToBase: 0.01 },
  { id: "m", symbol: "m", labelEn: "Meter", labelZh: "米", factorToBase: 1 },
  { id: "km", symbol: "km", labelEn: "Kilometer", labelZh: "千米 / 公里", factorToBase: 1000 },
  { id: "in", symbol: "in", labelEn: "Inch", labelZh: "英寸", factorToBase: 0.0254 },
  { id: "ft", symbol: "ft", labelEn: "Foot", labelZh: "英尺", factorToBase: 0.3048 },
  { id: "yd", symbol: "yd", labelEn: "Yard", labelZh: "码", factorToBase: 0.9144 },
  { id: "mi", symbol: "mi", labelEn: "Mile", labelZh: "英里", factorToBase: 1609.344 },
  { id: "nmi", symbol: "nmi", labelEn: "Nautical Mile", labelZh: "海里", factorToBase: 1852 },
];

const MASS_UNITS: LinearUnitDef[] = [
  { id: "mg", symbol: "mg", labelEn: "Milligram", labelZh: "毫克", factorToBase: 0.001 },
  { id: "g", symbol: "g", labelEn: "Gram", labelZh: "克", factorToBase: 1 },
  { id: "jin", symbol: "斤", labelEn: "Jin (500g)", labelZh: "市斤 (500g)", factorToBase: 500 },
  { id: "kg", symbol: "kg", labelEn: "Kilogram", labelZh: "千克 / 公斤", factorToBase: 1000 },
  { id: "t", symbol: "t", labelEn: "Metric Ton", labelZh: "公吨", factorToBase: 1_000_000 },
  { id: "oz", symbol: "oz", labelEn: "Ounce", labelZh: "盎司", factorToBase: 28.349523125 },
  { id: "lb", symbol: "lb", labelEn: "Pound", labelZh: "磅", factorToBase: 453.59237 },
];

const AREA_UNITS: LinearUnitDef[] = [
  { id: "mm2", symbol: "mm²", labelEn: "Sq Millimeter", labelZh: "平方毫米", factorToBase: 1e-6 },
  { id: "cm2", symbol: "cm²", labelEn: "Sq Centimeter", labelZh: "平方厘米", factorToBase: 1e-4 },
  { id: "m2", symbol: "m²", labelEn: "Sq Meter", labelZh: "平方米", factorToBase: 1 },
  { id: "ha", symbol: "ha", labelEn: "Hectare", labelZh: "公顷", factorToBase: 10_000 },
  { id: "mu", symbol: "亩", labelEn: "Mu (China)", labelZh: "市亩", factorToBase: 2000 / 3 },
  { id: "km2", symbol: "km²", labelEn: "Sq Kilometer", labelZh: "平方公里", factorToBase: 1_000_000 },
  { id: "ft2", symbol: "ft²", labelEn: "Sq Foot", labelZh: "平方英尺", factorToBase: 0.09290304 },
  { id: "acre", symbol: "acre", labelEn: "Acre", labelZh: "英亩", factorToBase: 4046.8564224 },
];

const VOLUME_UNITS: LinearUnitDef[] = [
  { id: "ml", symbol: "mL", labelEn: "Milliliter / cm³", labelZh: "毫升 / cm³", factorToBase: 0.001 },
  { id: "l", symbol: "L", labelEn: "Liter / dm³", labelZh: "升 / dm³", factorToBase: 1 },
  { id: "m3", symbol: "m³", labelEn: "Cubic Meter", labelZh: "立方米", factorToBase: 1000 },
  { id: "tsp", symbol: "tsp", labelEn: "US Teaspoon", labelZh: "美制茶匙", factorToBase: 0.00492892159375 },
  { id: "floz", symbol: "fl oz", labelEn: "US Fluid Ounce", labelZh: "美制液盎司", factorToBase: 0.0295735295625 },
  { id: "cup", symbol: "cup", labelEn: "US Cup", labelZh: "美制杯", factorToBase: 0.2365882365 },
  { id: "gal", symbol: "gal", labelEn: "US Gallon", labelZh: "美制加仑", factorToBase: 3.785411784 },
];

const ANGLE_UNITS: LinearUnitDef[] = [
  { id: "deg", symbol: "°", labelEn: "Degree", labelZh: "度 (deg)", factorToBase: 1 },
  { id: "rad", symbol: "rad", labelEn: "Radian", labelZh: "弧度 (rad)", factorToBase: 180 / Math.PI },
  { id: "grad", symbol: "grad", labelEn: "Gradian", labelZh: "百分度 (grad)", factorToBase: 0.9 },
  { id: "turn", symbol: "turn", labelEn: "Turn", labelZh: "圈 (turn)", factorToBase: 360 },
];

export const UNIT_CATEGORY_META: Record<
  UnitCategory,
  { labelEn: string; labelZh: string; defaultUnit: string; defaultValue: string }
> = {
  css: { labelEn: "CSS Units", labelZh: "CSS 单位", defaultUnit: "px", defaultValue: "16" },
  duration: { labelEn: "Duration / TTL", labelZh: "时间 / 缓存时长", defaultUnit: "h", defaultValue: "24" },
  length: { labelEn: "Length", labelZh: "长度", defaultUnit: "m", defaultValue: "1" },
  mass: { labelEn: "Mass / Weight", labelZh: "质量 / 重量", defaultUnit: "kg", defaultValue: "1" },
  temperature: { labelEn: "Temperature", labelZh: "温度", defaultUnit: "c", defaultValue: "25" },
  area: { labelEn: "Area", labelZh: "面积", defaultUnit: "m2", defaultValue: "100" },
  volume: { labelEn: "Volume", labelZh: "体积", defaultUnit: "l", defaultValue: "1" },
  angle: { labelEn: "Angle", labelZh: "角度", defaultUnit: "deg", defaultValue: "90" },
};

export function formatUnitNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1e-12) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-7) {
    return Number(n.toPrecision(8)).toExponential();
  }
  const clean = Number(n.toPrecision(12));
  return clean.toLocaleString("en-US", { maximumFractionDigits: 8, useGrouping: false });
}

function getCssUnits(ctx: CssContext): LinearUnitDef[] {
  const root = ctx.rootPx > 0 ? ctx.rootPx : 16;
  const parent = ctx.parentPx > 0 ? ctx.parentPx : 16;
  const vw = ctx.vwPx > 0 ? ctx.vwPx : 1440;
  const vh = ctx.vhPx > 0 ? ctx.vhPx : 900;
  const vmin = Math.min(vw, vh);
  const vmax = Math.max(vw, vh);
  return [
    { id: "px", symbol: "px", labelEn: "Pixels", labelZh: "像素 (px)", factorToBase: 1 },
    { id: "rem", symbol: "rem", labelEn: `Root em (${root}px)`, labelZh: `根字体 (rem=${root}px)`, factorToBase: root },
    { id: "em", symbol: "em", labelEn: `Parent em (${parent}px)`, labelZh: `父字体 (em=${parent}px)`, factorToBase: parent },
    { id: "pct", symbol: "%", labelEn: `Percent of ${parent}px`, labelZh: `百分比 (${parent}px)`, factorToBase: parent / 100 },
    { id: "vw", symbol: "vw", labelEn: `Viewport W (${vw}px)`, labelZh: `视口宽 vw (${vw}px)`, factorToBase: vw / 100 },
    { id: "vh", symbol: "vh", labelEn: `Viewport H (${vh}px)`, labelZh: `视口高 vh (${vh}px)`, factorToBase: vh / 100 },
    { id: "vmin", symbol: "vmin", labelEn: "Viewport min", labelZh: "视口较小边 vmin", factorToBase: vmin / 100 },
    { id: "vmax", symbol: "vmax", labelEn: "Viewport max", labelZh: "视口较大边 vmax", factorToBase: vmax / 100 },
    { id: "pt", symbol: "pt", labelEn: "Points (1/72 in)", labelZh: "点 (pt)", factorToBase: 96 / 72 },
    { id: "pc", symbol: "pc", labelEn: "Picas (12 pt)", labelZh: "派卡 (pc)", factorToBase: 16 },
    { id: "in", symbol: "in", labelEn: "Inches (96 px)", labelZh: "英寸 (96px)", factorToBase: 96 },
    { id: "cm", symbol: "cm", labelEn: "Centimeters", labelZh: "厘米 (cm)", factorToBase: 96 / 2.54 },
    { id: "mm", symbol: "mm", labelEn: "Millimeters", labelZh: "毫米 (mm)", factorToBase: 96 / 25.4 },
  ];
}

export function listUnitsForCategory(category: UnitCategory, ctx: CssContext): Array<{ id: string; symbol: string; labelEn: string; labelZh: string }> {
  if (category === "temperature") {
    return [
      { id: "c", symbol: "°C", labelEn: "Celsius", labelZh: "摄氏度" },
      { id: "f", symbol: "°F", labelEn: "Fahrenheit", labelZh: "华氏度" },
      { id: "k", symbol: "K", labelEn: "Kelvin", labelZh: "开尔文" },
    ];
  }
  return getLinearDefs(category, ctx);
}

function getLinearDefs(category: UnitCategory, ctx: CssContext): LinearUnitDef[] {
  switch (category) {
    case "css": return getCssUnits(ctx);
    case "duration": return DURATION_UNITS;
    case "length": return LENGTH_UNITS;
    case "mass": return MASS_UNITS;
    case "area": return AREA_UNITS;
    case "volume": return VOLUME_UNITS;
    case "angle": return ANGLE_UNITS;
    default: return [];
  }
}

export function convertUnits(
  category: UnitCategory,
  value: number,
  fromUnit: string,
  ctx: CssContext = { rootPx: 16, parentPx: 16, vwPx: 1440, vhPx: 900 },
): UnitResultRow[] {
  if (!Number.isFinite(value)) return [];
  if (category === "temperature") {
    let celsius = value;
    if (fromUnit === "f") celsius = ((value - 32) * 5) / 9;
    else if (fromUnit === "k") celsius = value - 273.15;
    const f = (celsius * 9) / 5 + 32;
    const k = celsius + 273.15;
    return [
      { id: "c", symbol: "°C", labelEn: "Celsius", labelZh: "摄氏度", raw: celsius, formatted: formatUnitNumber(celsius) },
      { id: "f", symbol: "°F", labelEn: "Fahrenheit", labelZh: "华氏度", raw: f, formatted: formatUnitNumber(f) },
      { id: "k", symbol: "K", labelEn: "Kelvin", labelZh: "开尔文", raw: k, formatted: formatUnitNumber(k) },
    ];
  }
  const defs = getLinearDefs(category, ctx);
  const src = defs.find((d) => d.id === fromUnit) ?? defs[0];
  if (!src) return [];
  const baseVal = value * src.factorToBase;
  return defs.map((d) => {
    const raw = baseVal / d.factorToBase;
    return {
      id: d.id,
      symbol: d.symbol,
      labelEn: d.labelEn,
      labelZh: d.labelZh,
      raw,
      formatted: formatUnitNumber(raw),
    };
  });
}

export function formatDurationBreakdown(totalMs: number, isZh: boolean): string {
  if (!Number.isFinite(totalMs) || totalMs < 0) return "";
  if (totalMs === 0) return isZh ? "0 毫秒" : "0 ms";
  let rem = Math.round(totalMs);
  const parts: string[] = [];
  const steps: Array<[number, string, string]> = [
    [86400 * 1000, "d", "天"],
    [3600 * 1000, "h", "小时"],
    [60 * 1000, "m", "分"],
    [1000, "s", "秒"],
    [1, "ms", "毫秒"],
  ];
  for (const [unitMs, en, zh] of steps) {
    if (rem >= unitMs) {
      const q = Math.floor(rem / unitMs);
      rem %= unitMs;
      parts.push(isZh ? `${q}${zh}` : `${q}${en}`);
    }
  }
  return parts.join(" ");
}
