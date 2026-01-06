const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

router.get("/me", protect, userController.getMe);
router.put("/me", protect, userController.updateMe);
router.put("/me/password", protect, userController.updatePassword);
router.post("/register-pengguna", userController.registerPengguna);
router.patch("/me/contact", protect, userController.updateContact);
router.patch("/me/media", protect, userController.updateMedia);
router.put("/me/password", protect, userController.updatePassword);
router.post("/request-admin", protect, userController.requestAdminAccess);
router.put(
  "/update-fcm",
  protect,
  userController.updateFcmToken
);

module.exports = router;
