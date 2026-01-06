const express = require("express");
const router = express.Router();
const testController = require("../controllers/testController");

router.post("/get-token", testController.getTestToken);

router.post("/fcm", testController.testFcm);

module.exports = router;
