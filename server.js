import express from "express";
import { calcCorte } from "./calcCorte.js";

const app = express();
app.use(express.json());

app.post("/calc/corte", (req, res) => {
  try {
    const result = calcCorte(req.body);
    res.json(result);
  } catch (err) {
    if (err.message === "MISSING_FIELDS") {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        missing_fields: err.missing_fields
      });
    }
    if (err.message === "UNSUPPORTED_SPEED" || err.message === "INVALID_LASER_TYPE") {
      return res.status(400).json({
        error: err.message,
        details: err.details
      });
    }
    if (err.message === "INVALID_RESULT") {
      return res.status(500).json({
        error: "INVALID_RESULT",
        details: err.details
      });
    }
    res.status(500).json({ error: "INTERNAL_ERROR", details: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Motor de cálculo de procesos (corte) activo en puerto ${PORT}`)
);
