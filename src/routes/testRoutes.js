// src/routes/testRoutes.js
const express = require("express");
const router = express.Router();
const testController = require("../controllers/testController");

// Endpoint: POST /api/test/get-token
router.post("/get-token", testController.getTestToken);

router.post("/fcm", testController.testFcm);

module.exports = router;