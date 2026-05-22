const express = require("express");
const unblockRouter = require("./unblock");

const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({ success: true, status: "ok" });
});

router.use("/unblock", unblockRouter);

module.exports = router;
