const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

router.post("/check-user", authController.checkUser);
router.post("/exchange-custom-token", authController.exchangeToken);
router.get("/me", protect, authController.getMe);
router.post("/register-pengguna", authController.registerPengguna);
router.post("/register-admin-sekolah", protect, authController.registerAdmin);
router.post("/send-otp-email", authController.sendOtpEmail);
router.post("/verify-otp", authController.verifyOtp);
router.post("/reset-password", authController.resetPassword);
router.post("/request-email-change-otp", protect, authController.requestEmailChange);
router.post("/verify-email-change", protect, authController.verifyEmailChange);
router.post("/request-phone-change-otp", protect, authController.requestPhoneChange);
router.post("/verify-phone-change", protect, authController.verifyPhoneChange);
router.put("/me/password", protect, authController.updatePassword);

module.exports = router;