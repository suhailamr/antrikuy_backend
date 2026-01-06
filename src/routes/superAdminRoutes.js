const express = require("express");
const router = express.Router();
const superAdminController = require("../controllers/superAdminController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Middleware pembantu agar kode lebih pendek
const superAdminOnly = [protect, authorize("SUPER_ADMIN")];
const researcherAndAdmin = [protect, authorize("SUPER_ADMIN", "PENELITI")];

// --- MANAJEMEN SEKOLAH UMUM ---
router.get("/schools/all", researcherAndAdmin, superAdminController.getAllSchools);
router.get("/schools/pending", researcherAndAdmin, superAdminController.getPendingSchools);
router.get("/schools/:schoolId", researcherAndAdmin, superAdminController.getSchoolById);
router.get("/schools/:schoolId/members", researcherAndAdmin, superAdminController.getSchoolMembers);

// --- REQUEST SEKOLAH BARU (PENERIMAAN) ---
router.post("/schools/review", researcherAndAdmin, superAdminController.reviewSchoolRequest);

// --- REQUEST PEMBUBARAN SEKOLAH ---
// 1. Admin sekolah mengajukan pembubaran
router.post("/schools/:schoolId/request-dissolve", protect, superAdminController.requestSchoolDissolution);

// 2. Super Admin melihat daftar pengajuan pembubaran
router.get("/dissolve-requests/pending", protect, authorize('SUPER_ADMIN'), superAdminController.getPendingDissolutions);
// 3. Super Admin mengeksekusi (Setuju/Tolak)
router.post("/approve-dissolve/:requestId", superAdminOnly, superAdminController.approveDissolution);
router.post("/reject-dissolve/:requestId", superAdminOnly, superAdminController.rejectDissolution);

module.exports = router;