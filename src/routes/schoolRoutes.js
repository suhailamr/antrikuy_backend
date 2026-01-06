const express = require("express");
const router = express.Router();
const schoolController = require("../controllers/schoolController");
const { protect, authorize } = require("../middleware/authMiddleware");

// --- PUBLIC / USER BIASA ---
router.get("/", protect, schoolController.listSchools);
router.get("/my", protect, schoolController.getMySchoolStatus);

// --- PENDAFTARAN SEKOLAH BARU ---
router.post('/request', protect, schoolController.requestNewSchool);

// --- DASHBOARD ADMIN SEKOLAH ---
router.get('/dashboard-admin', protect, schoolController.getAdminStats);
router.post("/leave", protect, schoolController.leaveSchool);
router.post("/:schoolId/join", protect, schoolController.joinSchool);
router.post("/:schoolId/cancel-request", protect, schoolController.cancelJoinRequest);

// --- MANAJEMEN ANGGOTA (HANYA ADMIN) ---
router.get("/members", protect, authorize("ADMIN", "SUPER_ADMIN"), schoolController.listMembers);
router.put("/members/:membershipId/status", protect, authorize("ADMIN", "SUPER_ADMIN"), schoolController.updateMemberStatus);
router.put('/admin-request/respond', protect, authorize("ADMIN", "SUPER_ADMIN"), schoolController.approveAdminRequest);

module.exports = router;