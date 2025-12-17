// calcCorte.js
// Motor puro de cálculo: Corte térmico (láser) + Material
// Sin dependencias de DOM. Basado en la lógica de corte4.html. :contentReference[oaicite:1]{index=1}

/* =========================
   Tablas internas del motor
   ========================= */

// Densidades por material (kg/m3)
export const rhoByMaterial = { acero: 7850, inox: 8000, aluminio: 2700, cobre: 8900 };

// Presets por tipo de láser
export const LASER_PRESETS = {
  co2:   { P: 3.0, Fg: 8,  Pg: 0.40, Ccons: 6.0, Cmnt: 8.0, Camort: 20.0 },
  fibra: { P: 4.0, Fg: 10, Pg: 0.60, Ccons: 4.0, Cmnt: 4.0, Camort: 30.0 },
  ndyag: { P: 2.0, Fg: 6,  Pg: 0.40, Ccons: 5.0, Cmnt: 6.0, Camort: 25.0 },
  disco: { P: 5.0, Fg: 12, Pg: 0.60, Ccons: 4.5, Cmnt: 4.5, Camort: 32.0 }
};

// Espesores de referencia (mm)
export const THK = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25];

// Velocidades (m/min) por material / tipoLaser / espesor (THK index)
export const SPEEDS = {
  acero: {
    co2:   [18, 12, 8,   5,  3.5, 2.5, 2,   1.4, 1,   0.8, 0.6, 0.4, 0.3],
    fibra: [28, 20, 12,  8,  6,   5.5, 5,   3.5, 2.5, 2,   1.5, 1,   0.7],
    ndyag: [15, 10, 7,   4,  3,   2.8, 3,   2,   1.5, 1.2, 1,   0.6, 0.4],
    disco: [25, 18, 10.5,7,  5.5, 5,   4.5, 3.2, 2,   1.6, 1.2, 0.9, 0.6]
  },
  inox: {
    co2:   [16, 10, 6,   4,  3,   2.3, 1.8, 1.2, 0.9, 0.7, 0.5, 0.3, 0.2],
    fibra: [26, 18, 11,  7,  5.5, 4.5, 4,   2.8, 2,   1.6, 1.2, 0.8, 0.6],
    ndyag: [14, 9,  5,   3.5,2.8, 2.2, 2.5, 1.8, 1.2, 1,   0.8, 0.5, 0.3],
    disco: [22, 16, 9.5, 6,  5,   4,   3.5, 2.4, 1.8, 1.4, 1,   0.7, 0.5]
  },
  aluminio: {
    co2:   [null, 8,  5,  3,  2.2, 1.6, 1,   0.7, 0.5, 0.4, 0.3, 0.2, 0.15],
    fibra: [25,  15, 10, 6,  5,   4,   3,   2.2, 1.5, 1.2, 0.9, 0.6, 0.4],
    ndyag: [null, 6,  4.5,2,  1.8, 1.5, 1.5, 1,   0.8, 0.6, 0.4, 0.3, 0.2],
    disco: [22,  14, 9,  5,  4,   3.2, 2.5, 1.8, 1.2, 1,   0.8, 0.5, 0.35]
  },
  cobre: {
    co2:   [null, null, null, null, null, null, null, null, null, null, null, null, null],
    fibra: [20,  12,   8,   5,  3.5, 2.8, 2,   1.3, 1,   0.8, 0.6, 0.4, 0.3],
    ndyag: [null, null, null, null, null, null, null, null, null, null, null, null, null],
    disco: [18,  10,   7,   4,  3,   2.5, 1.5, 1,   0.8, 0.6, 0.5, 0.3, 0.2]
  }
};

/* =========================
   Helpers
   ========================= */

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function toNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function interpSpeed(arr, thk) {
  // Interpolación lineal sobre THK[] para el array de velocidades
  const n = THK.length;
  if (!arr || arr.length !== n) return null;

  if (thk <= THK[0]) return arr[0];
  if (thk >= THK[n - 1]) return arr[n - 1];

  for (let i = 0; i < n - 1; i++) {
    const t0 = THK[i], t1 = THK[i + 1];
    if (thk >= t0 && thk <= t1) {
      const v0 = arr[i], v1 = arr[i + 1];
      if (v0 == null || v1 == null) return null;
      const r = (thk - t0) / (t1 - t0);
      return v0 + r * (v1 - v0);
    }
  }
  return null;
}

function getSpeed(material, thk, tipoLaser) {
  const mat = SPEEDS[material];
  if (!mat) return null;
  const arr = mat[tipoLaser];
  if (!arr) return null;
  return interpSpeed(arr, thk);
}

/* =========================
   Motor principal
   ========================= */

/**
 * Calcula corte + material + totales (por pieza y por lote).
 *
 * Inputs recomendados (mínimos para modo auto):
 * - material: "acero" | "inox" | "aluminio" | "cobre"
 * - tipoLaser: "co2" | "fibra" | "ndyag" | "disco"
 * - espesor_mm, largo_mm, ancho_mm
 * - Np, Tp_s, Ts_min, Q
 * - Ce, Rlab, k, Ckg
 *
 * Opcionales (override si no quieres presets/auto):
 * - V_m_min, P_kW, Fg_m3_h, Pg_eur_m3, Ccons_eur_h, Cmnt_eur_h, Camort_eur_h
 * - rho_kg_m3 (override densidad)
 */
export function calcCorte(params) {
  const p = normalizeParams(params);

  // 1) Derivadas geométricas
  const L_m = 2 * (p.largo_mm + p.ancho_mm) / 1000; // perímetro (m/pz)
  const A_m2 = (p.largo_mm * p.ancho_mm) / 1e6;     // área (m²/pz)

  // 2) AutoFill (si aplica): velocidad por tabla + presets por tipo de láser
  const auto = applyAutoFill(p);

  // 3) Corte: tiempos
  const t_corte_h = (auto.V_m_min > 0) ? (L_m / (auto.V_m_min * 60)) : 0;
  const t_perf_h  = (auto.Np * auto.Tp_s) / 3600;
  const t_prep_h  = (auto.Q > 0) ? (auto.Ts_min / (auto.Q * 60)) : 0;
  const t_total_h = t_corte_h + t_perf_h + t_prep_h;

  // 4) Coste horario
  const energia_eur_h = auto.P_kW * auto.Ce_eur_kWh;
  const gas_eur_h     = auto.Fg_m3_h * auto.Pg_eur_m3;
  const C_h_eur_h     =
    auto.Camort_eur_h +
    auto.Cmnt_eur_h +
    auto.Rlab_eur_h +
    auto.Ccons_eur_h +
    energia_eur_h +
    gas_eur_h;

  // 5) Costes de corte
  const C_pieza_eur   = C_h_eur_h * t_total_h;
  const C_pieza_k_eur = C_pieza_eur * (1 + auto.k_frac);
  const C_m_eur       = (L_m > 0) ? (C_pieza_eur / L_m) : 0;
  const C_m_k_eur     = (L_m > 0) ? (C_pieza_k_eur / L_m) : 0;

  // 6) Material (peso bruto)
  const espesor_m = auto.espesor_mm / 1000;
  const Vol_m3 = A_m2 * espesor_m;
  const Pbruto_kg = Vol_m3 * auto.rho_kg_m3;

  const Cmaterial_pz_eur = Pbruto_kg * auto.Ckg_eur_kg;
  const Cmaterial_lote_eur = Cmaterial_pz_eur * auto.Q;

  // 7) Totales
  const subtotal_corte_pz_eur = C_pieza_k_eur;
  const total_pz_eur = subtotal_corte_pz_eur + Cmaterial_pz_eur;

  const subtotal_corte_lote_eur = subtotal_corte_pz_eur * auto.Q;
  const total_lote_eur = subtotal_corte_lote_eur + Cmaterial_lote_eur;

  // 8) Salida (numerazos + trazabilidad)
  const result = {
    proceso: "corte",

    // Derivadas geométricas
    L_m,
    A_m2,

    // Tiempos
    t_corte_h,
    t_perf_h,
    t_prep_h,
    t_total_h,

    // Corte
    C_h_eur_h,
    coste_por_pieza_sin_k_eur: C_pieza_eur,
    coste_por_pieza_eur: C_pieza_k_eur, // <- €/pieza (+k)
    coste_por_m_sin_k_eur: C_m_eur,
    coste_por_m_eur: C_m_k_eur,

    // Material
    rho_kg_m3: auto.rho_kg_m3,
    Vol_m3,
    Pbruto_kg,
    material_por_pieza_eur: Cmaterial_pz_eur,
    material_por_lote_eur: Cmaterial_lote_eur,

    // Totales
    subtotal_corte_por_pieza_eur: subtotal_corte_pz_eur,
    total_por_pieza_eur: total_pz_eur,
    subtotal_corte_por_lote_eur: subtotal_corte_lote_eur,
    total_por_lote_eur: total_lote_eur,

    // Parámetros realmente usados (incluye autoFill)
    parametros_usados: {
      material: auto.material,
      tipoLaser: auto.tipoLaser,
      espesor_mm: auto.espesor_mm,
      largo_mm: auto.largo_mm,
      ancho_mm: auto.ancho_mm,

      V_m_min: auto.V_m_min,
      Np: auto.Np,
      Tp_s: auto.Tp_s,
      Ts_min: auto.Ts_min,
      Q: auto.Q,

      P_kW: auto.P_kW,
      Ce_eur_kWh: auto.Ce_eur_kWh,
      Fg_m3_h: auto.Fg_m3_h,
      Pg_eur_m3: auto.Pg_eur_m3,
      Ccons_eur_h: auto.Ccons_eur_h,
      Cmnt_eur_h: auto.Cmnt_eur_h,
      Camort_eur_h: auto.Camort_eur_h,
      Rlab_eur_h: auto.Rlab_eur_h,
      k_frac: auto.k_frac,

      Ckg_eur_kg: auto.Ckg_eur_kg,
      rho_kg_m3: auto.rho_kg_m3,

      // Trazabilidad de autoFill
      auto_aplicado: auto._auto_aplicado
    }
  };

  // Guardarraíl: números obligatorios
  const mustBeNumbers = [
    "coste_por_pieza_eur",
    "subtotal_corte_por_pieza_eur",
    "total_por_pieza_eur",
    "subtotal_corte_por_lote_eur",
    "total_por_lote_eur"
  ];
  for (const k of mustBeNumbers) {
    if (!isNum(result[k])) {
      const err = new Error("INVALID_RESULT");
      err.details = `Campo no numérico: ${k}`;
      throw err;
    }
  }

  return result;
}

/* =========================
   Normalización + autofill
   ========================= */

function normalizeParams(params) {
  const p = { ...(params || {}) };

  // Campos mínimos para funcionar
  const required = ["material", "tipoLaser", "espesor_mm", "largo_mm", "ancho_mm"];
  const missing = required.filter(k => p[k] === undefined || p[k] === null || p[k] === "");
  if (missing.length) {
    const err = new Error("MISSING_FIELDS");
    err.missing_fields = missing;
    throw err;
  }

  // Normalización de tipos
  p.material   = String(p.material).trim();
  p.tipoLaser  = String(p.tipoLaser).trim();

  p.espesor_mm = toNum(p.espesor_mm);
  p.largo_mm   = toNum(p.largo_mm);
  p.ancho_mm   = toNum(p.ancho_mm);

  // Corte
  p.Np    = toNum(p.Np, 0);
  p.Tp_s  = toNum(p.Tp_s, 1);
  p.Ts_min= toNum(p.Ts_min, 10);
  p.Q     = toNum(p.Q, 50);

  // Econ / energía
  p.Ce_eur_kWh = toNum(p.Ce_eur_kWh, 0.15);
  p.Rlab_eur_h = toNum(p.Rlab_eur_h, 22);
  p.k_frac     = toNum(p.k_frac, 0.10);

  // Material
  p.Ckg_eur_kg = toNum(p.Ckg_eur_kg, 1.20);
  p.rho_kg_m3  = (p.rho_kg_m3 !== undefined && p.rho_kg_m3 !== null && p.rho_kg_m3 !== "")
    ? toNum(p.rho_kg_m3)
    : null;

  // Overrides (si vienen, se respetan; si no, se autocompletan)
  p.V_m_min     = (p.V_m_min     !== undefined && p.V_m_min     !== null && p.V_m_min     !== "") ? toNum(p.V_m_min) : null;
  p.P_kW        = (p.P_kW        !== undefined && p.P_kW        !== null && p.P_kW        !== "") ? toNum(p.P_kW) : null;
  p.Fg_m3_h     = (p.Fg_m3_h     !== undefined && p.Fg_m3_h     !== null && p.Fg_m3_h     !== "") ? toNum(p.Fg_m3_h) : null;
  p.Pg_eur_m3   = (p.Pg_eur_m3   !== undefined && p.Pg_eur_m3   !== null && p.Pg_eur_m3   !== "") ? toNum(p.Pg_eur_m3) : null;
  p.Ccons_eur_h = (p.Ccons_eur_h !== undefined && p.Ccons_eur_h !== null && p.Ccons_eur_h !== "") ? toNum(p.Ccons_eur_h) : null;
  p.Cmnt_eur_h  = (p.Cmnt_eur_h  !== undefined && p.Cmnt_eur_h  !== null && p.Cmnt_eur_h  !== "") ? toNum(p.Cmnt_eur_h) : null;
  p.Camort_eur_h= (p.Camort_eur_h!== undefined && p.Camort_eur_h!== null && p.Camort_eur_h!== "") ? toNum(p.Camort_eur_h) : null;

  return p;
}

function applyAutoFill(p) {
  const out = { ...p };
  out._auto_aplicado = { velocidad_por_tabla: false, presets_laser: false, rho_sugerida: false };

  // 1) Velocidad por tabla si no viene override
  if (out.V_m_min == null) {
    const v = getSpeed(out.material, out.espesor_mm, out.tipoLaser);
    if (v == null || !Number.isFinite(v)) {
      const err = new Error("UNSUPPORTED_SPEED");
      err.details = `No hay velocidad válida para material=${out.material}, espesor_mm=${out.espesor_mm}, tipoLaser=${out.tipoLaser}`;
      throw err;
    }
    out.V_m_min = Number(v.toFixed(2));
    out._auto_aplicado.velocidad_por_tabla = true;
  }

  // 2) Presets láser si no vienen overrides
  const preset = LASER_PRESETS[out.tipoLaser];
  if (!preset) {
    const err = new Error("INVALID_LASER_TYPE");
    err.details = `tipoLaser inválido: ${out.tipoLaser}`;
    throw err;
  }

  if (out.P_kW == null)        out.P_kW = preset.P;
  if (out.Fg_m3_h == null)     out.Fg_m3_h = preset.Fg;
  if (out.Pg_eur_m3 == null)   out.Pg_eur_m3 = preset.Pg;
  if (out.Ccons_eur_h == null) out.Ccons_eur_h = preset.Ccons;
  if (out.Cmnt_eur_h == null)  out.Cmnt_eur_h = preset.Cmnt;
  if (out.Camort_eur_h == null)out.Camort_eur_h = preset.Camort;

  out._auto_aplicado.presets_laser = true;

  // 3) Densidad sugerida si no viene override
  if (out.rho_kg_m3 == null) {
    out.rho_kg_m3 = rhoByMaterial[out.material] ?? 7850;
    out._auto_aplicado.rho_sugerida = true;
  }

  return out;
}
