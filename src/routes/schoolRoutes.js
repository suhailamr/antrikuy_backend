const express = require("express");
const router = express.Router();
const schoolController = require("../controllers/schoolController");

// 🔥 PERUBAHAN 1: Import menggunakan Destructuring
const { protect, authorize } = require("../middleware/authMiddleware");

const QueueEntry = require("../models/QueueEntry"); 
const Event = require("../models/Events");

// 🔥 PERUBAHAN 2: Ganti 'verifyFirebaseToken' jadi 'protect'

// Public / User Biasa
router.get("/", protect, schoolController.listSchools);
router.post("/", schoolController.createSchool); // Jika ini public registration
router.get("/my", protect, schoolController.getMySchoolStatus);

router.get(
  '/dashboard-admin', 
  protect, 
  schoolController.getAdminStats
);

router.post("/leave", protect, schoolController.leaveSchool);
router.post("/:schoolId/join", protect, schoolController.joinSchool);
router.post("/:schoolId/cancel-request", protect, schoolController.cancelJoinRequest);

// Update Sekolah (Sebaiknya dilindungi protect)
router.patch("/:schoolId", protect, schoolController.updateSchool);

// 🔥 PERUBAHAN 3: Tambahkan 'authorize' untuk route khusus Admin
// Hanya Admin Sekolah atau Super Admin yang boleh lihat member & approve request
router.get(
    "/members", 
    protect, 
    authorize("ADMIN", "SUPER_ADMIN"), 
    schoolController.listMembers
);

router.put(
    "/members/:membershipId/status", 
    protect, 
    authorize("ADMIN", "SUPER_ADMIN"), 
    schoolController.updateMemberStatus
);

router.put(
    '/admin-request/respond', 
    protect, 
    authorize("ADMIN", "SUPER_ADMIN"), 
    schoolController.approveAdminRequest
);

router.post('/request', protect, schoolController.requestNewSchool);



module.exports = router;